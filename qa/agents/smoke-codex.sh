#!/usr/bin/env bash
# Smoke test for a future Codex adapter. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "const path = require('path'); const pj = require.resolve('@playwright/mcp/package.json', { paths: ['$repo/apps/api'] }); path.join(path.dirname(pj), require(pj).bin['playwright-mcp'])")"
prompt="$(cat "$here/smoke-prompt.md")"

cd "$work"
codex exec "Do the task in your instructions now." \
  --ignore-user-config --ignore-rules --ephemeral --skip-git-repo-check \
  -s read-only \
  -c approval_policy="never" \
  -c developer_instructions="$prompt" \
  -c 'mcp_servers.ajour.url="http://127.0.0.1:8787/mcp/ajour"' \
  -c 'mcp_servers.ajour.bearer_token_env_var="AJOUR_MCP_TOKEN"' \
  -c 'mcp_servers.playwright.command="node"' \
  -c "mcp_servers.playwright.args=[\"$pw_cli\",\"--browser\",\"chrome\",\"--user-data-dir\",\"$profile\"]" \
  --json \
  | tee "$here/codex.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
