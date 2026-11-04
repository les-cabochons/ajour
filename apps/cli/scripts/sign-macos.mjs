import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

for (const name of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY_P8",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
]) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-sign-"));
const keychain = path.join(dir, "sign.keychain-db");
const run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const p12 = path.join(dir, "certificate.p12");
  const source = process.env.CSC_LINK;
  const bytes = source.startsWith("https://")
    ? Buffer.from(await (await fetch(source)).arrayBuffer())
    : Buffer.from(source, "base64");
  await writeFile(p12, bytes, { mode: 0o600 });
  const password = randomBytes(24).toString("hex");
  run("security", ["create-keychain", "-p", password, keychain]);
  run("security", ["unlock-keychain", "-p", password, keychain]);
  run("security", [
    "import",
    p12,
    "-k",
    keychain,
    "-P",
    process.env.CSC_KEY_PASSWORD,
    "-T",
    "/usr/bin/codesign",
  ]);
  run("security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  const identities = run("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  const identity = identities.match(
    /([A-F0-9]{40}) "Developer ID Application:/,
  )?.[1];
  if (!identity) throw new Error("No Developer ID Application identity");
  const binary = "apps/cli/out/ajour";
  run("codesign", [
    "--force",
    "--sign",
    identity,
    "--keychain",
    keychain,
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    "apps/cli/scripts/entitlements.plist",
    binary,
  ]);
  run("codesign", ["--verify", "--strict", binary]);
  const zip = path.join(dir, "ajour.zip");
  run("ditto", ["-c", "-k", "--keepParent", binary, zip]);
  const key = path.join(dir, "notary.p8");
  await writeFile(key, process.env.APPLE_API_KEY_P8, { mode: 0o600 });
  const result = JSON.parse(
    run("xcrun", [
      "notarytool",
      "submit",
      zip,
      "--key",
      key,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
      "--wait",
      "--output-format",
      "json",
    ]),
  );
  if (result.status !== "Accepted")
    throw new Error(`Notarization ${result.id}: ${result.status}`);
} catch {
  // Child-process errors can contain command arguments with credentials.
  throw new Error(
    "CLI signing or notarization failed. Check certificate validity and Apple credentials.",
  );
} finally {
  try {
    run("security", ["delete-keychain", keychain]);
  } catch {
    /* May not have been created. */
  }
  await rm(dir, { recursive: true, force: true });
}
