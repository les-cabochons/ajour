"use strict";

/**
 * The code requirement a released macOS `ajour` binary must meet: signed
 * through Apple's chain by Ajour's Developer ID team. The CLI release checks
 * its signed binary against this same requirement before notarizing it.
 */
const CLI_SIGNING_REQUIREMENT =
  'anchor apple generic and certificate leaf[subject.OU] = "DDX8GJH69G"';

/**
 * `codesign` arguments that verify `file` against a requirement. codesign
 * reads a -R value as a path to a compiled requirement unless it starts
 * with "=", so the text form always carries it.
 */
function codesignVerifyArgs(file, requirement = CLI_SIGNING_REQUIREMENT) {
  return ["--verify", "--strict", "-R", `=${requirement}`, file];
}

module.exports = { CLI_SIGNING_REQUIREMENT, codesignVerifyArgs };
