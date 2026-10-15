#!/usr/bin/env bash
# Stop hook (opt-in): set HULL_STOP_CHECKS=1 in .claude/settings.local.json "env" to enable.
# Exit 2 sends the first error back to Claude and keeps it working.
[ "${HULL_STOP_CHECKS:-}" = "1" ] || exit 0
input="$(cat)"
# Already continuing because of this hook: do not loop.
case "$input" in *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;; esac
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
command -v pnpm >/dev/null 2>&1 || exit 0
out="$(pnpm turbo run lint typecheck test --affected --output-logs=errors-only 2>&1)" && exit 0
{
  echo "stop-checks failed. First error:"
  printf '%s\n' "$out" | grep -m1 -i -E 'error|fail|✖' || printf '%s\n' "$out" | tail -n 5
} >&2
exit 2
