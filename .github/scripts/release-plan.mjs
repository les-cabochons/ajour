import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stableTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;
const releaseTagPattern = /^v(\d+)\.(\d+)\.(\d+)(?:-(?:nightly-\d{8}\.\d+|alpha\.\d{8}\.\d+))?$/;

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid release version: ${value}`);
  }

  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

export function coreVersionFromTag(tag) {
  const match = releaseTagPattern.exec(tag);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

export function parseNightlyTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)-nightly-(\d{8})\.(\d{3,})$/.exec(tag);
  if (!match) {
    throw new Error(`Invalid nightly tag: ${tag}. Expected vX.Y.Z-nightly-YYYYMMDD.NNN.`);
  }

  return {
    version: match[1],
    date: match[2],
    sequence: match[3],
  };
}

export function highestVersion(versions) {
  return versions.reduce(
    (highest, candidate) => !highest || compareVersions(candidate, highest) > 0 ? candidate : highest,
    undefined,
  );
}

export function planNightly({
  configuredVersion,
  tags,
  date,
  headTags = [],
  reachableTags = tags,
  publishedTags = tags,
}) {
  const existingHeadTag = headTags
    .filter((tag) => {
      try {
        parseNightlyTag(tag);
        return true;
      } catch {
        return false;
      }
    })
    .sort()
    .at(-1);
  if (existingHeadTag) {
    const { version } = parseNightlyTag(existingHeadTag);
    return {
      version,
      tag: existingHeadTag,
      packageVersion: packageVersionForTag(existingHeadTag),
      bump: "nightly",
    };
  }

  const publishedTagSet = new Set(publishedTags);
  const releaseVersions = reachableTags
    .filter((tag) => publishedTagSet.has(tag))
    .map(coreVersionFromTag)
    .filter(Boolean);
  const version = highestVersion([configuredVersion, ...releaseVersions]);
  const escapedVersion = version.replaceAll(".", "\\.");
  const nightlyPattern = new RegExp(`^v${escapedVersion}-nightly-${date}\\.(\\d+)$`);
  const highestSequence = tags.reduce((highest, tag) => {
    const match = nightlyPattern.exec(tag);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const sequence = String(highestSequence + 1).padStart(3, "0");

  return {
    version,
    tag: `v${version}-nightly-${date}.${sequence}`,
    packageVersion: `${version}-nightly-${date}-${sequence}`,
    bump: "nightly",
  };
}

export function classifyStableBump(commitMessages) {
  if (commitMessages.length === 0) {
    throw new Error("There are no commits since the latest stable release.");
  }

  const headers = commitMessages.map((message) => message.split(/\r?\n/, 1)[0]);
  const breaking = commitMessages.some((message, index) =>
    /(^|\n)BREAKING[ -]CHANGE\s*:/i.test(message) || /^[a-z][a-z0-9-]*(?:\([^\r\n)]*\))?!:/i.test(headers[index]),
  );
  if (breaking) {
    throw new Error("Breaking changes require a manual major release. Update VERSION to the intended X.0.0 version first.");
  }

  return headers.some((header) => /^feat(?:\([^\r\n)]*\))?:/i.test(header)) ? "minor" : "patch";
}

export function incrementVersion(version, bump) {
  const [major, minor, patch] = parseVersion(version);
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (bump === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`Unsupported stable bump: ${bump}`);
}

export function planStable({
  configuredVersion,
  tags,
  commitMessages,
  headTags = [],
  publishedTags = tags,
  allTags = tags,
}) {
  const stableVersions = publishedTags
    .map((tag) => stableTagPattern.test(tag) ? tag.slice(1) : undefined)
    .filter(Boolean);
  const latestStableVersion = highestVersion(stableVersions);
  const latestStableTag = latestStableVersion ? `v${latestStableVersion}` : undefined;
  const existingHeadStableVersions = headTags
    .map((tag) => stableTagPattern.test(tag) ? tag.slice(1) : undefined)
    .filter(Boolean);
  const existingHeadStableVersion = highestVersion(existingHeadStableVersions);

  if (existingHeadStableVersion && existingHeadStableVersion === latestStableVersion) {
    const previousStableVersion = highestVersion(stableVersions.filter((version) => version !== existingHeadStableVersion));
    return {
      version: existingHeadStableVersion,
      tag: `v${existingHeadStableVersion}`,
      packageVersion: existingHeadStableVersion,
      bump: "existing",
      previousStableTag: previousStableVersion ? `v${previousStableVersion}` : undefined,
    };
  }

  let version;
  let bump;
  if (!latestStableVersion) {
    version = highestVersion([
      configuredVersion,
      ...publishedTags.map(coreVersionFromTag).filter(Boolean),
    ]);
    bump = "initial";
  } else if (compareVersions(configuredVersion, latestStableVersion) > 0) {
    const [configuredMajor, configuredMinor, configuredPatch] = parseVersion(configuredVersion);
    const [stableMajor] = parseVersion(latestStableVersion);
    if (configuredMajor <= stableMajor || configuredMinor !== 0 || configuredPatch !== 0) {
      throw new Error("VERSION may bypass automatic bumps only for a manual X.0.0 major release.");
    }
    version = configuredVersion;
    bump = "manual";
  } else {
    bump = classifyStableBump(commitMessages);
    version = incrementVersion(latestStableVersion, bump);
  }

  const tag = `v${version}`;
  if (headTags.includes(tag)) {
    return {
      version,
      tag,
      packageVersion: version,
      bump: "existing",
      previousStableTag: latestStableTag,
    };
  }
  if (allTags.includes(tag)) {
    throw new Error(`Stable tag ${tag} is reserved on another commit. Recover or remove that pending reservation before retrying.`);
  }

  return {
    version,
    tag,
    packageVersion: version,
    bump,
    previousStableTag: latestStableTag,
  };
}

export function packageVersionForTag(tag) {
  const nightly = /^v(\d+\.\d+\.\d+)-nightly-(\d{8})\.(\d+)$/.exec(tag);
  if (nightly) {
    return `${nightly[1]}-nightly-${nightly[2]}-${nightly[3].padStart(3, "0")}`;
  }

  const stable = stableTagPattern.exec(tag);
  if (stable) {
    return `${stable[1]}.${stable[2]}.${stable[3]}`;
  }

  throw new Error(`Unsupported release tag: ${tag}`);
}

export function releaseDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function readTags() {
  const output = git(["tag", "--list", "v*"]);
  return output ? output.split(/\r?\n/) : [];
}

function readPublishedReleaseTags(tags) {
  const publishedTagsPath = process.env.PUBLISHED_RELEASE_TAGS_FILE;
  if (!publishedTagsPath) {
    return tags;
  }

  const output = readFileSync(publishedTagsPath, "utf8").trim();
  if (!output) {
    return [];
  }

  const publishedTagSet = new Set(output.split(/\r?\n/).filter(Boolean));
  return tags.filter((tag) => publishedTagSet.has(tag));
}

function readCommitMessages(previousTag, target = "HEAD") {
  if (!previousTag) {
    return [];
  }

  const output = git(["log", "--format=%B%x00", `${previousTag}..${target}`]);
  return output ? output.split("\0").map((message) => message.trim()).filter(Boolean) : [];
}

function latestReleaseTag(tags, target = "HEAD") {
  const releaseTags = new Set(tags.filter((tag) => releaseTagPattern.test(tag)));
  if (releaseTags.size === 0) {
    return undefined;
  }

  const tagsByCommit = new Map();
  const references = git(["for-each-ref", "--format=%(refname:short)%09%(*objectname)%09%(objectname)", "refs/tags"]);
  for (const reference of references.split(/\r?\n/)) {
    const [tag, peeledCommit, object] = reference.split("\t");
    if (!releaseTags.has(tag)) {
      continue;
    }

    const commit = peeledCommit || object;
    const commitTags = tagsByCommit.get(commit) ?? [];
    commitTags.push(tag);
    tagsByCommit.set(commit, commitTags);
  }

  const firstParentHistory = git(["rev-list", "--first-parent", target]);
  for (const commit of firstParentHistory.split(/\r?\n/)) {
    const commitTags = tagsByCommit.get(commit);
    if (commitTags) {
      return commitTags.sort().at(-1);
    }
  }

  return undefined;
}

function writeOutputs(plan, previousTag, additionalOutputs = {}) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const outputs = {
    tag: plan.tag,
    version: plan.version,
    package_version: plan.packageVersion,
    bump: plan.bump,
    previous_tag: previousTag ?? "",
    ...additionalOutputs,
  };

  for (const [name, value] of Object.entries(outputs)) {
    console.log(`${name}=${value}`);
    if (outputPath) {
      appendFileSync(outputPath, `${name}=${value}\n`);
    }
  }
}

function gitSucceeds(args) {
  return spawnSync("git", args, { cwd: repositoryRoot, stdio: "ignore" }).status === 0;
}

function resolveNightlyTarget(tag, promotionBase) {
  parseNightlyTag(tag);
  const reference = `refs/tags/${tag}`;
  if (!gitSucceeds(["show-ref", "--verify", "--quiet", reference])) {
    throw new Error(`Selected nightly tag does not exist: ${tag}`);
  }

  const targetSha = git(["rev-list", "-n", "1", reference]);
  if (!gitSucceeds(["merge-base", "--is-ancestor", targetSha, promotionBase])) {
    throw new Error(`Selected nightly ${tag} is not an ancestor of the dispatched main revision.`);
  }

  return targetSha;
}

function setDesktopPackageVersion(tag) {
  const packagePath = path.join(repositoryRoot, "apps/desktop/package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.version = packageVersionForTag(tag);
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Desktop package version set to ${packageJson.version}`);
}

function run() {
  const [command, value] = process.argv.slice(2);
  if (command === "set-package-version") {
    if (!value) {
      throw new Error("set-package-version requires a release tag.");
    }
    setDesktopPackageVersion(value);
    return;
  }

  const configuredVersion = readFileSync(path.join(repositoryRoot, "VERSION"), "utf8").trim();
  parseVersion(configuredVersion);
  const tags = readTags();
  const publishedTags = readPublishedReleaseTags(tags);

  if (command === "nightly") {
    const date = releaseDate();
    const tagsAtHeadOutput = git(["tag", "--points-at", "HEAD"]);
    const headTags = tagsAtHeadOutput ? tagsAtHeadOutput.split(/\r?\n/) : [];
    const mergedTagsOutput = git(["tag", "--merged", "HEAD", "--list", "v*"]);
    const mergedTags = mergedTagsOutput ? mergedTagsOutput.split(/\r?\n/) : [];
    const publishedTagSet = new Set(publishedTags);
    const publishedMergedTags = mergedTags.filter((tag) => publishedTagSet.has(tag));
    const plan = planNightly({
      configuredVersion,
      tags,
      date,
      headTags,
      reachableTags: mergedTags,
      publishedTags,
    });
    writeOutputs(plan, latestReleaseTag(publishedMergedTags.filter((tag) => tag !== plan.tag)));
    return;
  }

  if (command === "stable") {
    if (!value) {
      throw new Error("stable requires the nightly tag to promote.");
    }

    const targetSha = resolveNightlyTarget(value, process.env.PROMOTION_BASE_SHA ?? "HEAD");
    const targetConfiguredVersion = git(["show", `${targetSha}:VERSION`]).trim();
    parseVersion(targetConfiguredVersion);
    const publishedTagSet = new Set(publishedTags);
    const globalStableTags = publishedTags.filter((tag) => stableTagPattern.test(tag));
    const globalLatestStableVersion = highestVersion(globalStableTags.map((tag) => tag.slice(1)));
    const globalLatestStableTag = globalLatestStableVersion ? `v${globalLatestStableVersion}` : undefined;
    if (globalLatestStableTag && !gitSucceeds(["merge-base", "--is-ancestor", globalLatestStableTag, targetSha])) {
      throw new Error(`Selected nightly ${value} predates the latest stable release ${globalLatestStableTag}.`);
    }

    const mergedTagsOutput = git(["tag", "--merged", targetSha, "--list", "v*"]);
    const mergedTags = mergedTagsOutput ? mergedTagsOutput.split(/\r?\n/) : [];
    const publishedMergedTags = mergedTags.filter((tag) => publishedTagSet.has(tag));
    const stableTags = publishedMergedTags.filter((tag) => stableTagPattern.test(tag));
    const latestStableVersion = highestVersion(stableTags.map((tag) => tag.slice(1)));
    const latestStableTag = latestStableVersion ? `v${latestStableVersion}` : undefined;
    const tagsAtHeadOutput = git(["tag", "--points-at", targetSha]);
    const headTags = tagsAtHeadOutput ? tagsAtHeadOutput.split(/\r?\n/) : [];
    const plan = planStable({
      configuredVersion: targetConfiguredVersion,
      tags: mergedTags,
      commitMessages: readCommitMessages(latestStableTag, targetSha),
      headTags,
      publishedTags: publishedMergedTags,
      allTags: tags,
    });
    writeOutputs(
      plan,
      plan.previousStableTag ?? latestReleaseTag(
        publishedMergedTags.filter((tag) => tag !== plan.tag && tag !== value),
        targetSha,
      ),
      { target_sha: targetSha, nightly_tag: value },
    );
    return;
  }

  throw new Error("Usage: node .github/scripts/release-plan.mjs <nightly|stable NIGHTLY_TAG|set-package-version TAG>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
