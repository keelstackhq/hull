#!/usr/bin/env bash
# SessionStart hook: install dependencies and refresh docs. Never blocks a session.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
status="ok"
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --prefer-offline --silent >/dev/null 2>&1 || status="install failed"
  if [ -x node_modules/.bin/docspack ]; then
    pnpm exec docspack sync >/dev/null 2>&1 || status="docspack sync failed"
    pnpm exec docspack index --repo >/dev/null 2>&1 || status="docspack index failed"
  fi
else
  status="pnpm not found"
fi
echo "session-start: $status"
exit 0
