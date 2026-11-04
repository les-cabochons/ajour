import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const SECRETS = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY_P8",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
];
for (const name of SECRETS) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-sign-"));
const keychain = path.join(dir, "sign.keychain-db");
const password = randomBytes(24).toString("hex");

/** Removes every credential from text a tool printed. */
function redact(text) {
  let safe = text;
  // Longest first, so a credential inside another is never half removed.
  const values = [...SECRETS.map((name) => process.env[name]), password]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const value of values) safe = safe.split(value).join("***");
  return safe.trim();
}

/** A step that failed, said without its arguments, which hold credentials. */
class StepError extends Error {}

/**
 * Runs one signing step. On failure it reports the step, its exit status
 * and what the tool printed, with credentials removed, never the command
 * line: `security import -P` carries the certificate's password.
 */
function run(step, file, args) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout;
  const printed = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const status = result.error
    ? redact(String(result.error.message))
    : `exit ${result.status ?? result.signal}`;
  throw new StepError(
    `CLI signing failed at "${step}" (${status}).${printed ? `\n${printed}` : ""}`,
  );
}

/** The user's keychain search list, as `security list-keychains` prints it. */
function searchList() {
  return [
    ...run("read keychain list", "security", [
      "list-keychains",
      "-d",
      "user",
    ]).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
}

let restoreSearchList;
let keychainCreated = false;
let failure;
try {
  const p12 = path.join(dir, "certificate.p12");
  const source = process.env.CSC_LINK;
  let bytes;
  if (source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new StepError(
        `CLI signing failed at "download certificate" (HTTP ${response.status}).`,
      );
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = Buffer.from(source, "base64");
  }
  await writeFile(p12, bytes, { mode: 0o600 });
  run("create keychain", "security", [
    "create-keychain",
    "-p",
    password,
    keychain,
  ]);
  keychainCreated = true;
  run("unlock keychain", "security", [
    "unlock-keychain",
    "-p",
    password,
    keychain,
  ]);
  run("import certificate", "security", [
    "import",
    p12,
    "-k",
    keychain,
    "-P",
    process.env.CSC_KEY_PASSWORD,
    "-T",
    "/usr/bin/codesign",
  ]);
  run("allow codesign", "security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  // codesign looks up the identity's key and chain through the search
  // list, even with --keychain: a keychain outside it fails with "The
  // specified item could not be found in the keychain."
  const original = searchList();
  run("add keychain to search list", "security", [
    "list-keychains",
    "-d",
    "user",
    "-s",
    keychain,
    ...original,
  ]);
  restoreSearchList = () =>
    spawnSync("security", ["list-keychains", "-d", "user", "-s", ...original], {
      stdio: "ignore",
    });
  const identities = run("find identity", "security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  const identity = identities.match(
    /([A-F0-9]{40}) "Developer ID Application:/,
  )?.[1];
  if (!identity) {
    throw new StepError(
      'CLI signing failed at "find identity": no Developer ID Application identity in the certificate.',
    );
  }
  const binary = "apps/cli/out/ajour";
  run("codesign", "codesign", [
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
  run("verify signature", "codesign", ["--verify", "--strict", binary]);
  const zip = path.join(dir, "ajour.zip");
  run("zip for notarization", "ditto", [
    "-c",
    "-k",
    "--keepParent",
    binary,
    zip,
  ]);
  const key = path.join(dir, "notary.p8");
  await writeFile(key, process.env.APPLE_API_KEY_P8, { mode: 0o600 });
  const result = JSON.parse(
    run("notarize", "xcrun", [
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
  if (result.status !== "Accepted") {
    throw new StepError(
      `CLI notarization ${redact(String(result.id))} ended ${redact(String(result.status))}.`,
    );
  }
} catch (error) {
  // Only our own messages are printed: anything else may carry a credential.
  failure =
    error instanceof StepError
      ? error
      : new Error(
          "CLI signing or notarization failed. Check certificate validity and Apple credentials.",
        );
}

// Every cleanup runs, whatever failed before it; a runner left with the
// signing keychain on its search list fails the step.
const unclean = [];
if (restoreSearchList && restoreSearchList().status !== 0) {
  unclean.push("restore the keychain search list");
}
if (
  keychainCreated &&
  spawnSync("security", ["delete-keychain", keychain], { stdio: "ignore" })
    .status !== 0
) {
  unclean.push("delete the signing keychain");
}
await rm(dir, { recursive: true, force: true }).catch(() =>
  unclean.push("remove the temporary signing files"),
);
const cleanup = unclean.length
  ? `CLI signing couldn't ${unclean.join(", ")}.`
  : "";
if (failure) {
  // A new error: the stack Node prints keeps the message it was made with.
  throw cleanup ? new StepError(`${failure.message}\n${cleanup}`) : failure;
}
if (cleanup) throw new Error(cleanup);
