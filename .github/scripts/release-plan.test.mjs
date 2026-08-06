import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStableBump,
  coreVersionFromTag,
  packageVersionForTag,
  parseNightlyTag,
  planNightly,
  planStable,
  releaseDate,
} from "./release-plan.mjs";

test("creates the requested first nightly tag from the alpha baseline", () => {
  assert.deepEqual(
    planNightly({
      configuredVersion: "0.0.1",
      tags: ["v0.0.1-alpha.20260803.1"],
      date: "20260804",
    }),
    {
      version: "0.0.1",
      tag: "v0.0.1-nightly.20260804.1",
      packageVersion: "0.0.1-nightly.20260804.1",
      bump: "nightly",
    },
  );
});

test("increments one global nightly build number across dates", () => {
  const tags = [
    "v0.0.1-nightly-20260804.001",
    "v0.0.1-nightly-20260804.002",
  ];

  assert.equal(planNightly({ configuredVersion: "0.0.1", tags, date: "20260804" }).tag, "v0.0.1-nightly.20260804.3");
  assert.equal(planNightly({ configuredVersion: "0.0.1", tags, date: "20260805" }).tag, "v0.0.1-nightly.20260805.3");
});

test("keeps incrementing the global build number after a version change", () => {
  const plan = planNightly({
    configuredVersion: "0.1.0",
    tags: ["v0.0.1-nightly-20260804.009"],
    reachableTags: ["v0.0.1-nightly-20260804.009"],
    publishedTags: ["v0.0.1-nightly-20260804.009"],
    date: "20260805",
  });

  assert.equal(plan.tag, "v0.1.0-nightly.20260805.10");
});

test("does not inherit a release series from an unreachable later tag", () => {
  const plan = planNightly({
    configuredVersion: "0.0.1",
    tags: ["v0.0.1-nightly-20260804.001", "v1.0.0-nightly-20260805.001"],
    reachableTags: ["v0.0.1-nightly-20260804.001"],
    publishedTags: ["v0.0.1-nightly-20260804.001", "v1.0.0-nightly-20260805.001"],
    date: "20260805",
  });

  assert.equal(plan.tag, "v0.0.1-nightly.20260805.2");
});

test("reuses the tag already reserved for the same commit", () => {
  const tags = [
    "v0.0.1-nightly-20260804.001",
    "v0.0.1-nightly-20260804.002",
  ];

  assert.equal(
    planNightly({
      configuredVersion: "0.0.1",
      tags,
      headTags: ["v0.0.1-nightly-20260804.002"],
      date: "20260805",
    }).tag,
    "v0.0.1-nightly-20260804.002",
  );
});

test("reuses the original nightly after that commit is promoted", () => {
  const originalNightly = "v0.0.1-nightly-20260804.002";
  const plan = planNightly({
    configuredVersion: "0.0.1",
    tags: [originalNightly, "v0.1.0"],
    reachableTags: [originalNightly, "v0.1.0"],
    publishedTags: [originalNightly, "v0.1.0"],
    headTags: [originalNightly, "v0.1.0"],
    date: "20260805",
  });

  assert.equal(plan.tag, originalNightly);
});

test("publishes the configured baseline as the first stable version", () => {
  const plan = planStable({
    configuredVersion: "0.0.1",
    tags: ["v0.0.1-alpha.20260803.1"],
    commitMessages: [],
  });

  assert.equal(plan.tag, "v0.0.1");
  assert.equal(plan.bump, "initial");
});

test("bumps minor for features and patch for other commits", () => {
  assert.equal(
    planStable({ configuredVersion: "0.0.1", tags: ["v0.0.1"], commitMessages: ["feat: add reports"] }).tag,
    "v0.1.0",
  );
  assert.equal(
    planStable({ configuredVersion: "0.0.1", tags: ["v0.0.1"], commitMessages: ["fix: correct timer"] }).tag,
    "v0.0.2",
  );
});

test("classifies only the commit header as feat or breaking", () => {
  assert.equal(classifyStableBump(["fix: correct timer\n\nfeat: example mentioned in the body"]), "patch");
  assert.equal(classifyStableBump(["docs: explain syntax\n\nfix!: example only"]), "patch");
  assert.throws(
    () => classifyStableBump(["fix: migrate storage\n\nBREAKING CHANGE: old data is incompatible"]),
    /manual major release/,
  );
});

test("requires VERSION to be changed for a major release", () => {
  assert.throws(
    () => classifyStableBump(["feat!: replace the storage format"]),
    /manual major release/,
  );

  assert.equal(
    planStable({
      configuredVersion: "1.0.0",
      tags: ["v0.9.0"],
      commitMessages: ["feat!: replace the storage format"],
    }).tag,
    "v1.0.0",
  );

  assert.throws(
    () => planStable({
      configuredVersion: "0.9.0",
      tags: ["v0.1.0"],
      commitMessages: ["feat: add reports"],
    }),
    /manual X\.0\.0 major release/,
  );
});

test("reuses an existing stable tag reserved for the same commit", () => {
  const plan = planStable({
    configuredVersion: "0.0.1",
    tags: ["v0.0.1", "v0.0.2"],
    headTags: ["v0.0.2"],
    commitMessages: [],
  });

  assert.equal(plan.tag, "v0.0.2");
  assert.equal(plan.bump, "existing");
  assert.equal(plan.previousStableTag, "v0.0.1");
});

test("recovers a pending stable reservation only on its original commit", () => {
  const common = {
    configuredVersion: "0.0.1",
    tags: ["v0.0.1", "v0.0.2"],
    allTags: ["v0.0.1", "v0.0.2"],
    publishedTags: ["v0.0.1"],
    commitMessages: ["fix: correct timer"],
  };

  assert.equal(planStable({ ...common, headTags: ["v0.0.2"] }).tag, "v0.0.2");
  assert.throws(
    () => planStable({ ...common, headTags: [] }),
    /reserved on another commit/,
  );
});

test("ignores tags outside the supported release formats", () => {
  assert.equal(coreVersionFromTag("v0.0.1-nightly-20260804.001"), "0.0.1");
  assert.equal(coreVersionFromTag("v0.0.1-nightly.20260805.2"), "0.0.1");
  assert.equal(coreVersionFromTag("v0.0.1-x$(echo-danger)"), undefined);
});

test("validates a nightly selected for stable promotion", () => {
  assert.deepEqual(parseNightlyTag("v0.1.0-nightly.20260805.12"), {
    version: "0.1.0",
    date: "20260805",
    sequence: "12",
  });
  assert.equal(parseNightlyTag("v0.1.0-nightly-20260805.012").sequence, "012");
  assert.throws(() => parseNightlyTag("v0.1.0"), /Invalid nightly tag/);
  assert.throws(() => parseNightlyTag("v0.1.0-nightly.20260805.012"), /Invalid nightly tag/);
});

test("uses SemVer package versions while retaining legacy tag compatibility", () => {
  assert.equal(packageVersionForTag("v0.0.1-nightly.20260805.2"), "0.0.1-nightly.20260805.2");
  assert.equal(packageVersionForTag("v0.0.1-nightly-20260804.001"), "0.0.1-nightly-20260804-001");
  assert.equal(packageVersionForTag("v0.1.0"), "0.1.0");
});

test("uses the Toronto calendar date at the UTC day boundary", () => {
  assert.equal(releaseDate(new Date("2026-08-05T02:00:00Z")), "20260804");
  assert.equal(releaseDate(new Date("2026-08-05T05:00:00Z")), "20260805");
});
