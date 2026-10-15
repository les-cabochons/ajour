#!/usr/bin/env bash
# Smoke test for a future OpenCode adapter. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
config_home="$(mktemp -d)"
trap 'rm -rf "$work" "$config_home"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "const path = require('path'); const pj = require.resolve('@playwright/mcp/package.json', { paths: ['$repo/apps/api'] }); path.join(path.dirname(pj), require(pj).bin['playwright-mcp'])")"
prompt_json="$(node -p "JSON.stringify(require('fs').readFileSync('$here/smoke-prompt.md', 'utf8'))")"

cd "$work"
XDG_CONFIG_HOME="$config_home" \
OPENCODE_DISABLE_PROJECT_CONFIG=1 \
OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
OPENCODE_DISABLE_CLAUDE_CODE=1 \
OPENCODE_CONFIG_CONTENT="{
  \"agent\": { \"ajour\": { \"prompt\": $prompt_json } },
  \"permission\": { \"*\": \"deny\", \"ajour_*\": \"allow\", \"playwright_*\": \"allow\" },
  \"mcp\": {
    \"ajour\": { \"type\": \"remote\", \"url\": \"http://127.0.0.1:8787/mcp/ajour\", \"oauth\": false,
      \"headers\": { \"Authorization\": \"Bearer {env:AJOUR_MCP_TOKEN}\" } },
    \"playwright\": { \"type\": \"local\",
      \"command\": [\"node\", \"$pw_cli\", \"--browser\", \"chrome\", \"--user-data-dir\", \"$profile\"] }
  }
}" \
opencode run "Do the task in your instructions now." --agent ajour --pure --format json \
  | tee "$here/opencode.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
