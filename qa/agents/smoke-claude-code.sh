#!/usr/bin/env bash
# Smoke test for the Claude Code adapter. Mirrors the flags in
# apps/api/src/agent-runner/adapters/claude-code.ts. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "const path = require('path'); const pj = require.resolve('@playwright/mcp/package.json', { paths: ['$repo/apps/api'] }); path.join(path.dirname(pj), require(pj).bin['playwright-mcp'])")"

# The token is referenced, never written: the file holds ${AJOUR_MCP_TOKEN}.
cat > "$work/mcp.json" <<JSON
{
  "mcpServers": {
    "ajour": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp/ajour",
      "headers": { "Authorization": "Bearer \${AJOUR_MCP_TOKEN}" }
    },
    "playwright": {
      "type": "stdio",
      "command": "node",
      "args": ["$pw_cli", "--browser", "chrome", "--user-data-dir", "$profile"]
    }
  }
}
JSON
cp "$here/smoke-prompt.md" "$work/prompt.md"

cd "$work"
CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
ENABLE_CLAUDEAI_MCP_SERVERS=false \
claude -p "Do the task in your instructions now." \
  --append-system-prompt-file "$work/prompt.md" \
  --mcp-config "$work/mcp.json" \
  --strict-mcp-config \
  --setting-sources "" \
  --disable-slash-commands \
  --tools "" \
  --allowedTools "mcp__ajour" "mcp__playwright" \
  --permission-mode dontAsk \
  --output-format stream-json --verbose \
  | tee "$here/claude-code.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
