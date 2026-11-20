#!/usr/bin/env bash
# One-time (and re-runnable) Fly.io setup. Every step checks first, so a second run changes nothing.
#   bash scripts/fly-setup.sh --app NAME --region iad --host api.example.com \
#        [--secrets-stdin] [--set-gh-secret production] [--deploy] [--dry-run]
#
# Steps, each only when its flag is given:
#   --region R           app (created if missing), volume "data" (1 GB), shared IPv4 + IPv6
#   --secrets-stdin      read KEY=VALUE lines from stdin; set only keys not yet set (staged, so no
#                        restart). Values travel on stdin only: never argv, never printed.
#   --host H             certificate for H (point DNS first, grey cloud / DNS-only; docs/fly.md)
#   --set-gh-secret ENV  create a Fly deploy token and store it as FLY_API_TOKEN in the GitHub
#                        environment ENV (for example production); skipped when it already exists
#   --fix-volume-owner   needs --region; run a throwaway alpine machine on volume "data" that chowns
#                        /data to 65532 (the image's user). Only when the volume is root-owned and no
#                        app machine uses it yet (docs/fly.md, Volume ownership). Re-runnable.
#   --deploy             fly deploy --remote-only
#   --dry-run            print every change instead of making it; read-only checks still run
# --app is always required. Without --region the app must already exist.
#
# Exit codes: 0 ok, 2 usage, 3 missing tool or not logged in (fly; gh with --set-gh-secret),
#             4 a fly or gh step failed.
set -uo pipefail

app="" region="" host="" ghenv="" deploy=0 fixvol=0 dry=0 stdin_secrets=0

usage() {
  echo "usage: fly-setup.sh --app NAME [--region R] [--host H] [--secrets-stdin] [--set-gh-secret ENV] [--fix-volume-owner] [--deploy] [--dry-run]" >&2
  exit 2
}
need() { [ $# -ge 2 ] && [ -n "$2" ] || usage; }
while [ $# -gt 0 ]; do
  case "$1" in
    --app) need "$@"; app="$2"; shift 2 ;;
    --region) need "$@"; region="$2"; shift 2 ;;
    --host) need "$@"; host="$2"; shift 2 ;;
    --set-gh-secret) need "$@"; ghenv="$2"; shift 2 ;;
    --secrets-stdin) stdin_secrets=1; shift ;;
    --fix-volume-owner) fixvol=1; shift ;;
    --deploy) deploy=1; shift ;;
    --dry-run) dry=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$app" ] || usage
[[ "$app" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "fly-setup: bad app name '$app'" >&2; exit 2; }
[ "$fixvol" = 0 ] || [ -n "$region" ] || usage
if [ -z "$region" ] && [ -z "$host" ] && [ -z "$ghenv" ] && [ "$deploy" = 0 ] && [ "$stdin_secrets" = 0 ]; then
  usage
fi

# Read stdin before anything else, so a failure later cannot leave a half-read pipe.
secrets=""
if [ "$stdin_secrets" = 1 ]; then
  secrets="$(cat)"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [[ "$line" =~ ^[A-Z][A-Z0-9_]*= ]] || { echo "fly-setup: stdin lines must be KEY=VALUE (KEY is [A-Z][A-Z0-9_]*)" >&2; exit 2; }
  done <<<"$secrets"
fi

command -v fly >/dev/null 2>&1 || { echo "fly-setup: fly (flyctl) not found; install it first" >&2; exit 3; }
fly auth whoami >/dev/null 2>&1 || { echo "fly-setup: not logged in; run: fly auth login" >&2; exit 3; }
if [ -n "$ghenv" ]; then
  command -v gh >/dev/null 2>&1 || { echo "fly-setup: gh not found; install the GitHub CLI" >&2; exit 3; }
  gh auth status >/dev/null 2>&1 || { echo "fly-setup: gh is not logged in; run: gh auth login" >&2; exit 3; }
fi

say() { echo "fly-setup: $*"; }
fail() { echo "fly-setup: step failed: $*" >&2; exit 4; }
# do_it DESCRIPTION CMD...: runs CMD, or only prints it with --dry-run.
do_it() {
  local what="$1"
  shift
  if [ "$dry" = 1 ]; then
    say "[dry-run] would $what: $*"
  else
    say "$what"
    "$@" >/dev/null || fail "$what"
  fi
}
listed() { # listed VALUE CMD...: does the read-only listing contain VALUE as a whole word?
  local v="$1" out
  shift
  out="$("$@" 2>/dev/null)" || fail "$*"
  grep -Eq "(^|[^A-Za-z0-9_.-])$v([^A-Za-z0-9_.-]|\$)" <<<"$out"
}
app_exists=0
listed "$app" fly apps list --json && app_exists=1

if [ -n "$region" ]; then
  if [ "$app_exists" = 1 ]; then
    say "app $app exists"
  else
    do_it "create app $app" fly apps create "$app"
  fi
  if [ "$app_exists" = 1 ] && listed "data" fly volumes list --app "$app" --json; then
    say "volume data exists"
  else
    do_it "create volume data in $region" fly volumes create data --app "$app" --region "$region" --size 1 --yes
  fi
  ips=""
  [ "$app_exists" = 1 ] && ips="$(fly ips list --app "$app" --json 2>/dev/null || true)"
  if grep -q "shared_v4" <<<"$ips"; then
    say "shared IPv4 exists"
  else
    do_it "allocate shared IPv4" fly ips allocate-v4 --shared --app "$app" --yes
  fi
  if grep -Eq '"v6"' <<<"$ips"; then
    say "IPv6 exists"
  else
    do_it "allocate IPv6" fly ips allocate-v6 --app "$app"
  fi
fi

if [ "$fixvol" = 1 ]; then
  do_it "chown volume data to 65532 with a throwaway machine" \
    fly machine run alpine:3 --app "$app" --region "$region" --volume data:/data --rm \
    chown -R 65532:65532 /data
fi

if [ "$stdin_secrets" = 1 ]; then
  existing=""
  [ "$app_exists" = 1 ] && existing="$(fly secrets list --app "$app" --json 2>/dev/null || true)"
  fresh=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    key="${line%%=*}"
    if grep -Eq "\"[A-Za-z]+\"[[:space:]]*:[[:space:]]*\"$key\"" <<<"$existing"; then
      say "secret $key is already set"
    else
      fresh+="$line"$'\n'
      say "secret $key to set"
    fi
  done <<<"$secrets"
  if [ -n "$fresh" ]; then
    if [ "$dry" = 1 ]; then
      say "[dry-run] would import the secrets above (staged) from stdin"
    else
      printf '%s' "$fresh" | fly secrets import --stage --app "$app" >/dev/null || fail "import secrets"
    fi
  fi
fi

if [ -n "$host" ]; then
  if [ "$app_exists" = 1 ] && listed "$host" fly certs list --app "$app" --json; then
    say "certificate for $host exists"
  else
    do_it "add certificate for $host" fly certs add "$host" --app "$app"
  fi
fi

if [ -n "$ghenv" ]; then
  if listed "FLY_API_TOKEN" gh secret list --env "$ghenv"; then
    say "FLY_API_TOKEN exists in GitHub environment $ghenv (delete it to rotate)"
  elif [ "$dry" = 1 ]; then
    say "[dry-run] would create a deploy token and store it as FLY_API_TOKEN in environment $ghenv"
  else
    say "create a deploy token and store it as FLY_API_TOKEN in environment $ghenv"
    token="$(fly tokens create deploy --app "$app")" && [ -n "$token" ] || fail "create deploy token"
    printf '%s' "$token" | gh secret set FLY_API_TOKEN --env "$ghenv" >/dev/null || fail "gh secret set"
  fi
fi

if [ "$deploy" = 1 ]; then
  do_it "deploy $app" fly deploy --app "$app" --remote-only
fi
say "done"
