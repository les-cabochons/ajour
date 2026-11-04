import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { lstatSync, readlinkSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { macosPrivilegedCommand } = require("../electron/cli-path.cjs");
assert.equal(process.platform, "darwin");
const root = `/private/var/ajour-check-${randomUUID()}`;
const destination = `${root}/local/bin/ajour`;
const target = `/Users/A "B"/it's\\$home/Ü/bin/ajour`;
const sudo = (...args) =>
  execFileSync("/usr/bin/sudo", ["-n", ...args], { encoding: "utf8" });
const exists = (name) => {
  try {
    lstatSync(name);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};

try {
  sudo("/bin/mkdir", "-m", "755", root);
  for (const ancestor of ["/", "/private", "/private/var", root]) {
    const entry = lstatSync(ancestor);
    assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), ancestor);
    assert.equal(entry.uid, 0, `${ancestor} must be root-owned`);
    assert.equal(
      entry.mode & 0o022,
      0,
      `${ancestor} must not be writable by group or others`,
    );
    console.log(`protected integration ancestor: ${ancestor}`);
  }
  for (const layer of ["shell", "AppleScript"]) {
    const run = (present, observed = "") => {
      const command = macosPrivilegedCommand({
        destination,
        target,
        present,
        observed,
      });
      return layer === "shell"
        ? sudo("/bin/sh", "-c", command.shell)
        : sudo(
            "/usr/bin/osascript",
            "-e",
            command.appleScript.replace(/ with administrator privileges$/, ""),
          );
    };
    run(true);
    assert.equal(readlinkSync(destination), target);
    console.log(
      `${layer}: creation and exact readlink passed, including missing ancestors and quoted Unicode target`,
    );
    assert.throws(() => run(false, "/wrong/target"));
    assert.equal(readlinkSync(destination), target);
    run(false, target);
    assert.equal(exists(destination), false);
    console.log(`${layer}: guarded removal passed`);
    for (const kind of ["file", "directory", "dangling symlink"]) {
      if (kind === "file") sudo("/usr/bin/touch", destination);
      else if (kind === "directory") sudo("/bin/mkdir", destination);
      else sudo("/bin/ln", "-s", "/nonexistent-ajour-check", destination);
      assert.throws(() => run(true));
      if (kind === "directory") {
        assert.deepEqual(readdirSync(destination), []);
        sudo("/bin/rmdir", destination);
      } else sudo("/bin/rm", destination);
      console.log(`${layer}: existing ${kind} refused`);
    }
    for (const unsafe of ["owner", "group write", "symlink"]) {
      if (unsafe === "owner")
        sudo("/usr/sbin/chown", String(process.getuid()), `${root}/local`);
      else if (unsafe === "group write")
        sudo("/bin/chmod", "775", `${root}/local`);
      else {
        sudo("/bin/mv", `${root}/local`, `${root}/saved`);
        sudo("/bin/ln", "-s", `${root}/saved`, `${root}/local`);
      }
      assert.throws(() => run(true));
      assert.equal(exists(destination), false);
      if (unsafe === "owner") sudo("/usr/sbin/chown", "0:0", `${root}/local`);
      else if (unsafe === "group write")
        sudo("/bin/chmod", "755", `${root}/local`);
      else {
        sudo("/bin/rm", `${root}/local`);
        sudo("/bin/mv", `${root}/saved`, `${root}/local`);
      }
      console.log(`${layer}: ancestor ${unsafe} refused`);
    }
    sudo("/bin/rmdir", `${root}/local/bin`, `${root}/local`);
  }
  console.log("macOS privileged command integration passed");
} finally {
  sudo("/bin/rm", "-rf", root);
}
