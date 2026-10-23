#!/usr/bin/env bash
# SessionStart hook: install the pinned toolchain, fetch crates, run session-start.d/. Never blocks a session.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
status="ok"
if command -v cargo >/dev/null 2>&1; then
  rustup show active-toolchain >/dev/null 2>&1 || rustup toolchain install >/dev/null 2>&1 || status="toolchain install failed"
  cargo fetch --locked --quiet >/dev/null 2>&1 || status="cargo fetch failed"
else
  status="cargo not found"
fi
echo "session-start: $status"
# Repo-local hooks (not owned by the template): every .claude/hooks/session-start.d/*.sh runs here;
# a failing one is reported and ignored.
for hook in .claude/hooks/session-start.d/*.sh; do
  [ -f "$hook" ] || continue
  "${BASH:-bash}" "$hook" || echo "session-start: $(basename "$hook") failed (ignored)"
done
exit 0
