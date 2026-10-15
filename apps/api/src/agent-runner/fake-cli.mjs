#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }. Also appends its argv, its working
// folder, whether AJOUR_MCP_TOKEN is set and the names of any other AJOUR_
// variables to FAKE_CLI_REPORT when set.
import { appendFileSync } from "node:fs";

if (process.env.FAKE_CLI_REPORT) {
  appendFileSync(
    process.env.FAKE_CLI_REPORT,
    JSON.stringify({
      argv: process.argv.slice(2),
      hasToken: Boolean(process.env.AJOUR_MCP_TOKEN),
      ajourKeys: Object.keys(process.env).filter(
        (key) => key.startsWith("AJOUR_") && key !== "AJOUR_MCP_TOKEN",
      ),
      cwd: process.cwd(),
    }) + "\n",
  );
}
const steps = JSON.parse(process.env.FAKE_CLI_SCRIPT ?? "[]");
for (const step of steps) {
  if (step.stdout) process.stdout.write(step.stdout + "\n");
  if (step.stderr) process.stderr.write(step.stderr + "\n");
  if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
  if (step.hang) await new Promise(() => {});
  if (step.exit !== undefined) process.exit(step.exit);
}
process.exit(0);
