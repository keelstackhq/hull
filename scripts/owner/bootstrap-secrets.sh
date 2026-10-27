#!/usr/bin/env bash
# One-time owner bootstrap for a sops secrets repo (spec 2026-10-27 §0, step C4).
# Run on the owner's computer, never in an agent session. It:
#   1. generates one age key per consumer (repo:env:provider); each private key goes straight
#      to the GitHub environment secret or CircleCI context var SOPS_AGE_KEY (stdin, never argv)
#      and is never printed or written to disk;
#   2. creates GitHub environments with a `main`-only deployment-branch rule;
#   3. prompts (hidden) for each bundle value and writes <env>/<bundle>.sops.yaml encrypted to
#      the owner keys + the consumers of that env, plus access.toml and .sops.yaml;
#   4. prints a verification block (public keys and names only) to paste into the chat.
#
# Usage:
#   bootstrap-secrets.sh --self-test
#   bootstrap-secrets.sh --secrets-dir DIR --owner-pub AGE1 [--owner-pub AGE1]...
#       --consumer OWNER/REPO:ENV:github|circleci ...
#       --bundle ENV/NAME=KEY1,KEY2[@NAME1,NAME2] ... [--push]
# A consumer's name is <repo>-<env> (e.g. keelstack-prod); @names (comma-separated) limits a bundle to those consumers.
# Env: CIRCLECI_TOKEN and CIRCLECI_ORG_ID only when a consumer uses circleci. gh must be logged in.
set -euo pipefail
set +x
umask 077

SOPS_VERSION="3.13.3"
die() { echo "bootstrap-secrets: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "missing $1"; }

check_tools() {
  need sops; need age-keygen; need jq
  sops --version 2>/dev/null | grep -q "^sops $SOPS_VERSION" || die "need sops $SOPS_VERSION"
}

# Encrypt a JSON object read on stdin to the comma-separated recipients in $2; output on stdout.
encrypt_json() {
  sops encrypt --filename-override "$1" --input-type json --output-type yaml --age "$2" /dev/stdin
}

expires_date() { date -u -d '+12 months' +%F 2>/dev/null || date -u -v+12m +%F; }

# Runs in a subshell so its EXIT trap removes only its own temp dir.
self_test() (
  check_tools
  tdir=$(mktemp -d)
  trap 'rm -rf "$tdir"' EXIT
  age-keygen -o "$tdir/k" 2>/dev/null
  pub=$(age-keygen -y "$tdir/k")
  printf '{"T":%s}' "$(printf 'self-test-value' | jq -Rs .)" | encrypt_json t/t.sops.yaml "$pub" > "$tdir/t.yaml"
  grep -q 'ENC\[AES256_GCM' "$tdir/t.yaml" || die "self-test: not encrypted"
  key=$(grep '^AGE-SECRET-KEY-' "$tdir/k")
  out=$(SOPS_AGE_KEY="$key" sops decrypt --input-type yaml --output-type json /dev/stdin < "$tdir/t.yaml" | jq -r .T)
  [ "$out" = "self-test-value" ] || die "self-test: round trip failed"
  echo "self-test ok (sops $SOPS_VERSION, age)"
)

store_github() { # repo env ; private key on stdin
  local custom
  # An existing environment keeps its reviewers; it must already use custom branch policies.
  if custom=$(gh api "repos/$1/environments/$2" --jq '.deployment_branch_policy.custom_branch_policies' 2>/dev/null) \
    && [ -n "$custom" ]; then
    [ "$custom" = true ] || die "environment $2 in $1 exists without a custom branch rule; set 'Selected branches' first"
  else
    gh api -X PUT "repos/$1/environments/$2" --input - >/dev/null <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
  fi
  gh api "repos/$1/environments/$2/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null \
    | grep -qx main || gh api -X POST "repos/$1/environments/$2/deployment-branch-policies" -f name=main -f type=branch >/dev/null
  gh secret set SOPS_AGE_KEY --env "$2" --repo "$1"
}

circleci_api() { # method path ; body on stdin
  curl -fsS -X "$1" "https://circleci.com/api/v2/$2" -H 'Content-Type: application/json' \
    --header @<(printf 'Circle-Token: %s\n' "$CIRCLECI_TOKEN") --data @-
}

store_circleci() { # context-name ; private key on stdin
  [ -n "${CIRCLECI_TOKEN:-}" ] && [ -n "${CIRCLECI_ORG_ID:-}" ] || die "set CIRCLECI_TOKEN and CIRCLECI_ORG_ID"
  local id
  id=$(curl -fsS "https://circleci.com/api/v2/context?owner-id=$CIRCLECI_ORG_ID" \
    --header @<(printf 'Circle-Token: %s\n' "$CIRCLECI_TOKEN") | jq -r --arg n "$1" '.items[] | select(.name==$n) | .id')
  if [ -z "$id" ]; then
    id=$(jq -n --arg n "$1" --arg o "$CIRCLECI_ORG_ID" '{name:$n, owner:{id:$o, type:"organization"}}' \
      | circleci_api POST context | jq -r .id)
  fi
  jq -Rs '{value: .}' | circleci_api PUT "context/$id/environment-variable/SOPS_AGE_KEY" >/dev/null
}

main() {
  local dir="" push=0 owners=() consumers=() bundles=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --self-test) self_test; return ;;
      --secrets-dir) dir=$2; shift ;;
      --owner-pub) owners+=("$2"); shift ;;
      --consumer) consumers+=("$2"); shift ;;
      --bundle) bundles+=("$2"); shift ;;
      --push) push=1 ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done
  [ -d "$dir/.git" ] || die "--secrets-dir must be a clone of the secrets repo"
  [ ${#owners[@]} -ge 1 ] || die "need at least one --owner-pub"
  [ ${#consumers[@]} -ge 1 ] || die "need at least one --consumer"
  check_tools; need gh; self_test >/dev/null

  local exp access pubs=() c repo env prov name key pub i
  exp=$(expires_date)
  access="version = 1"$'\n'
  for i in "${!owners[@]}"; do
    case "${owners[$i]}" in age1*) ;; *) die "--owner-pub must be an age1 public key" ;; esac
    access+=$'\n'"[[recipient]]"$'\n'"name = \"owner-$((i + 1))\""$'\n'"kind = \"human\""$'\n'"age = \"${owners[$i]}\""$'\n'"expires = \"$exp\""$'\n'
  done
  for c in "${consumers[@]}"; do
    IFS=: read -r repo env prov <<<"$c"
    [[ "$repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ && "$env" =~ ^[a-z0-9-]+$ && "$prov" =~ ^(github|circleci)$ ]] \
      || die "bad --consumer $c"
    name="${repo#*/}-$env"
    key=$(age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-')
    pub=$(printf '%s\n' "$key" | age-keygen -y)
    if [ "$prov" = github ]; then printf '%s' "$key" | store_github "$repo" "$env"
    else printf '%s' "$key" | store_circleci "$name"; fi
    key=""
    pubs+=("$env $name $pub")
    access+=$'\n'"[[recipient]]"$'\n'"name = \"$name\""$'\n'"kind = \"ci\""$'\n'"repo = \"$repo\""$'\n'"env = \"$env\""$'\n'"provider = \"$prov\""$'\n'"age = \"$pub\""$'\n'"expires = \"$exp\""$'\n'
  done

  # One rule per bundle file: recipients = owner keys + the named consumers (default: every
  # consumer of that env). A consumer never gets a file of another env.
  local sops_yaml="creation_rules:" b spec only path keys e names recips p k val json
  for b in "${bundles[@]}"; do
    spec=${b%%@*}; only=""; [ "$spec" != "$b" ] && only=${b#*@}
    path=${spec%%=*}; keys=${spec#*=}; e=${path%%/*}
    [[ "$path" =~ ^[a-z0-9-]+/[a-z0-9._-]+$ && -n "$keys" && "$keys" != "$spec" ]] || die "bad --bundle $b"
    names=$(printf '"owner-%s", ' $(seq 1 ${#owners[@]}))
    recips=$(IFS=,; echo "${owners[*]}")
    for p in "${pubs[@]}"; do
      read -r pe pn pk <<<"$p"
      [ "$pe" = "$e" ] || continue
      if [ -n "$only" ] && [[ ",$only," != *",$pn,"* ]]; then continue; fi
      names+="\"$pn\", "; recips+=",$pk"
    done
    [ "$recips" != "$(IFS=,; echo "${owners[*]}")" ] || die "no consumer of env $e for bundle $path"
    access+=$'\n'"[[rule]]"$'\n'"path = \"$path.sops.yaml\""$'\n'"recipients = [${names%, }]"$'\n'
    sops_yaml+=$'\n'"  - path_regex: ^${path//./\\.}\\.sops\\.yaml\$"$'\n'"    age: $recips"
    json="{"
    IFS=, read -ra kk <<<"$keys"
    for k in "${kk[@]}"; do
      [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "bad key $k"
      read -rsp "value for $path#$k: " val; echo >&2
      json+="\"$k\":$(printf '%s' "$val" | jq -Rs .),"
      val=""
    done
    mkdir -p "$dir/$e"
    printf '%s}' "${json%,}" | encrypt_json "$path.sops.yaml" "$recips" > "$dir/$path.sops.yaml"
    json=""
  done
  printf '%s' "$access" > "$dir/access.toml"
  printf '%s\n' "$sops_yaml" > "$dir/.sops.yaml"

  if grep -rq 'AGE-SECRET-KEY-' "$dir" --exclude-dir=.git; then
    die "a private key reached the repo dir; nothing was committed"
  fi
  if [ "$push" = 1 ]; then
    git -C "$dir" add -A && git -C "$dir" commit -qm "chore: bootstrap secrets (owner)" && git -C "$dir" push -q
  fi
  echo "--- paste into the chat (public data only) ---"
  echo "secrets repo: $(git -C "$dir" remote get-url origin 2>/dev/null || echo "(no origin)") @ $(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo "(no commit)")"
  printf 'consumer %s\n' "${pubs[@]}"
  (cd "$dir" && find . \( -name '*.sops.yaml' -o -name access.toml -o -name .sops.yaml \) -not -path './.git/*' | sort)
  echo "no private key in the repo dir: ok"
}

main "$@"
