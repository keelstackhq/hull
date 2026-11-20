#!/usr/bin/env bash
# Polls $SMOKE_URL/healthz until it answers 200, or SMOKE_TIMEOUT_SECS (default 60) pass.
#   SMOKE_URL=https://app.fly.dev bash scripts/smoke.sh
# Exit codes: 0 healthy, 1 timeout, 2 usage (SMOKE_URL missing or timeout not a number).
set -u

url="${SMOKE_URL:-}"
timeout="${SMOKE_TIMEOUT_SECS:-60}"
if [ -z "$url" ]; then
  echo "smoke: SMOKE_URL is required (base URL, no trailing /healthz)" >&2
  exit 2
fi
case "$timeout" in '' | *[!0-9]*)
  echo "smoke: SMOKE_TIMEOUT_SECS must be a whole number" >&2
  exit 2
  ;;
esac

url="${url%/}"
deadline=$(($(date +%s) + timeout))
while :; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url/healthz" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    echo "smoke: $url/healthz is 200"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "smoke: $url/healthz not 200 after ${timeout}s (last status: ${code:-none})" >&2
    exit 1
  fi
  sleep 2
done
