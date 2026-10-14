#!/usr/bin/env bash
# Status line (opt-in): add to .claude/settings.local.json
#   "statusLine": { "type": "command", "command": "bash .claude/statusline.sh" }
# Reads the session JSON on stdin: model.display_name, context_window.used_percentage,
# cost.total_cost_usd.
input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  model="$(printf '%s' "$input" | jq -r '.model.display_name // "?"')"
  pct="$(printf '%s' "$input" | jq -r '.context_window.used_percentage // "?"' | cut -d. -f1)"
  cost="$(printf '%s' "$input" | jq -r '.cost.total_cost_usd // "?"')"
else
  # No jq: best-effort extraction, "?" for anything not found.
  model="$(printf '%s' "$input" | sed -n 's/.*"display_name" *: *"\([^"]*\)".*/\1/p' | head -n 1)"
  pct="$(printf '%s' "$input" | sed -n 's/.*"used_percentage" *: *\([0-9][0-9]*\).*/\1/p' | head -n 1)"
  cost="$(printf '%s' "$input" | sed -n 's/.*"total_cost_usd" *: *\([0-9.][0-9.]*\).*/\1/p' | head -n 1)"
fi
: "${model:=?}" "${pct:=?}" "${cost:=?}"
case "$cost" in
  \?) cost_txt='?' ;;
  *) cost_txt="$(printf '%.2f' "$cost")" ;;
esac
printf '[%s] %s%% context | $%s\n' "$model" "${pct%%.*}" "$cost_txt"
