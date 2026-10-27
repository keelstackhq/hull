#!/usr/bin/env bash
# One-time owner bootstrap for a sops secrets repo (spec 2026-10-27 §0, step C5).
# Run on the owner's computer, never in an agent session. Needs bash >= 4.4, sops 3.13.3,
# age-keygen 1.3.x, jq, gh (logged in) and, for CircleCI consumers, curl.
#
# Phases (nothing is written before phase 4):
#   1. validate arguments and tools, run the self-test;
#   2. preflight: refuse a re-run (existing access.toml, SOPS_AGE_KEY already stored) unless
#      --rotate; check every existing GitHub environment allows exactly branch `main`;
#   3. prompt (hidden, one line per value) for every bundle value;
#   4. create/verify every environment and CircleCI context (with project + main-branch
#      restrictions) first; then per consumer generate an age key and store the private key as SOPS_AGE_KEY via stdin (never
#      argv, never printed, never on disk); then write access.toml, .sops.yaml and the encrypted
#      bundles, commit only those files (--push), and print public data to paste into the chat.
#
# Usage:
#   bootstrap-secrets.sh --self-test
#   bootstrap-secrets.sh --check-rulesets [--allow-app APP-ID]... OWNER/REPO...
#       read-only; exit 1 unless every repo has the release-tag ruleset (run it as the owner)
#   bootstrap-secrets.sh --secrets-dir DIR --owner-pub AGE1 [--owner-pub AGE1]...
#       --consumer OWNER/REPO:ENV:github
#       --consumer OWNER/REPO:ENV:circleci:CIRCLECI-PROJECT-ID ...
#       --bundle ENV/NAME=KEY1,KEY2[@NAME1,NAME2] ... [--push] [--rotate]
# A consumer's name is <repo>-<env> (e.g. keelstack-prod). @names limits a bundle to those
# consumers; without @names all consumers of that env get it, which is refused when they belong
# to more than one repo. --rotate replaces existing CI keys and requires every existing bundle to
# be listed again (all values are re-entered and re-encrypted).
# Env: CIRCLECI_TOKEN and CIRCLECI_ORG_ID when a consumer uses circleci.
set -euo pipefail
set +x
umask 077
if [ "${BASH_VERSINFO[0]}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  echo "bootstrap-secrets: needs bash >= 4.4 (macOS: brew install bash)" >&2
  exit 1
fi
shopt -s inherit_errexit

SOPS_VERSION="3.13.3"
CIRCLECI_API="https://circleci.com/api/v2"
MAIN_EXPR='pipeline.git.branch == "main"'
die() { echo "bootstrap-secrets: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "missing $1"; }

check_tools() {
  need sops; need age-keygen; need jq
  local v re_sops='^sops 3\.13\.3([[:space:]]|$)' re_age='^v?1\.3\.[0-9]+$'
  v=$(sops --version 2>/dev/null | head -n1 || true)
  [[ "$v" =~ $re_sops ]] || die "need sops $SOPS_VERSION (found: ${v:-none})"
  v=$(age-keygen --version 2>/dev/null | head -n1 || true)
  [[ "$v" =~ $re_age ]] || die "need age-keygen 1.3.x (found: ${v:-none})"
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
  echo "self-test ok (sops $SOPS_VERSION, age-keygen $(age-keygen --version))"
)

# --- GitHub ---------------------------------------------------------------------------------

# gh_get PATH: body on stdout; returns 4 on HTTP 404; any other error ends the script.
gh_get() {
  local out rc=0
  out=$(gh api "$1" 2>"$TMPD/gh.err" </dev/null) || rc=$?
  if [ "$rc" -eq 0 ]; then printf '%s' "$out"; return 0; fi
  if grep -q '(HTTP 404)' "$TMPD/gh.err"; then return 4; fi
  die "gh api $1 failed: $(head -n1 "$TMPD/gh.err")"
}

# preflight_github REPO ENV: prints absent | needs-main | ready. Read-only.
preflight_github() {
  local body rc=0 pol names total secrets
  body=$(gh_get "repos/$1/environments/$2") || rc=$?
  if [ "$rc" -eq 4 ]; then echo absent; return 0; fi
  [ "$rc" -eq 0 ] || exit 1
  [ "$(jq -r '.deployment_branch_policy.protected_branches' <<<"$body")" = false ] &&
    [ "$(jq -r '.deployment_branch_policy.custom_branch_policies' <<<"$body")" = true ] ||
    die "environment $2 in $1 must use 'Selected branches and tags' (not all branches, not protected branches)"
  pol=$(gh_get "repos/$1/environments/$2/deployment-branch-policies?per_page=100") ||
    die "could not read the deployment branch policies of environment $2 in $1"
  total=$(jq -r '.total_count' <<<"$pol")
  [ "$total" -le 100 ] || die "environment $2 in $1 has $total deployment policies; expected only branch main"
  names=$(jq -r '.branch_policies[] | "\(.type // "branch") \(.name)"' <<<"$pol" | sort | paste -sd, -)
  secrets=$(gh secret list --env "$2" --repo "$1" --json name </dev/null) || die "gh secret list for $1/$2 failed"
  if [ "$(jq -r 'any(.[]; .name == "SOPS_AGE_KEY")' <<<"$secrets")" = true ] && [ "$ROTATE" != 1 ]; then
    die "$1 environment $2 already has SOPS_AGE_KEY; refusing to replace it without --rotate"
  fi
  case "$names" in
    "") echo needs-main ;;
    "branch main") echo ready ;;
    *) die "environment $2 in $1 allows '$names'; it must allow exactly branch main" ;;
  esac
}

# setup_github REPO ENV STATE: create the environment and its main-only rule if needed.
setup_github() {
  if [ "$3" = absent ]; then
    jq -cn '{deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' |
      gh api -X PUT "repos/$1/environments/$2" --input - >/dev/null
  fi
  if [ "$3" != ready ]; then
    gh api -X POST "repos/$1/environments/$2/deployment-branch-policies" -f name=main -f type=branch </dev/null >/dev/null
  fi
}

# tag_ruleset REPO: prints ok | missing | unknown (details on stderr). "ok" = an active tag ruleset
# (the repo's own or an inherited org one) that
#   - includes refs/tags/*-v* (or ~ALL) and excludes nothing,
#   - restricts tag creation, update and deletion,
#   - lets only these bypass: Repository admin (RepositoryRole 5), OrganizationAdmin, and the
#     GitHub Apps given with --allow-app (e.g. the D-008 release app).
# bypass_actors is visible only to admins: without it the result is "unknown" (fail closed), so the
# owner's own run is the binding check. Private repos need GitHub Pro/Team for rulesets.
tag_ruleset() {
  local list ids id r unknown=""
  if ! list=$(gh_get "repos/$1/rulesets?includes_parents=true&per_page=100"); then echo unknown; return 0; fi
  if ! jq -e 'type == "array"' <<<"$list" >/dev/null 2>&1; then
    echo "bootstrap-secrets: rulesets of $1: unexpected response" >&2
    echo unknown
    return 0
  fi
  ids=$(jq -r '.[] | select(.target == "tag" and .enforcement == "active") | .id' <<<"$list")
  for id in $ids; do
    if ! r=$(gh_get "repos/$1/rulesets/$id?includes_parents=true"); then unknown=1; continue; fi
    if ! jq -e 'type == "object" and has("bypass_actors")' <<<"$r" >/dev/null 2>&1; then
      echo "bootstrap-secrets: ruleset $id of $1: bypass list not visible (run as a repo admin)" >&2
      unknown=1
      continue
    fi
    if jq -e --arg apps "${ALLOW_APPS:-}" '
      ($apps | split(",") | map(select(. != ""))) as $allowed
      | ((.conditions.ref_name.include // []) | any(. == "refs/tags/*-v*" or . == "~ALL"))
      and ((.conditions.ref_name.exclude // []) | length == 0)
      and ([.rules[]?.type] | (index("creation") != null and index("update") != null and index("deletion") != null))
      and (.bypass_actors | all(
        (.actor_type == "RepositoryRole" and .actor_id == 5)
        or .actor_type == "OrganizationAdmin"
        or (.actor_type == "Integration" and ((.actor_id | tostring) as $i | $allowed | index($i) != null))))
    ' <<<"$r" >/dev/null 2>&1; then
      echo ok
      return 0
    fi
    echo "bootstrap-secrets: ruleset $id of $1 does not qualify (pattern, excludes, rules or bypass list)" >&2
  done
  if [ -n "$unknown" ]; then echo unknown; else echo missing; fi
}

# --- CircleCI -------------------------------------------------------------------------------

cci() { # METHOD PATH; request body on stdin unless GET
  if [ "$1" = GET ]; then
    curl -fsS "$CIRCLECI_API/$2" --header @<(printf 'Circle-Token: %s\n' "$CIRCLECI_TOKEN") </dev/null
  else
    curl -fsS -X "$1" "$CIRCLECI_API/$2" -H 'Content-Type: application/json' \
      --header @<(printf 'Circle-Token: %s\n' "$CIRCLECI_TOKEN") --data-binary @-
  fi
}

cci_items() { # PATH: every item of every page, one JSON object per line
  local sep='?' tok="" body
  case "$1" in *\?*) sep='&' ;; esac
  while :; do
    if [ -n "$tok" ]; then body=$(cci GET "$1${sep}page-token=$tok"); else body=$(cci GET "$1"); fi
    jq -c '.items[]?' <<<"$body"
    tok=$(jq -r '.next_page_token // empty' <<<"$body")
    [ -n "$tok" ] || break
  done
}

# preflight_circleci CONTEXT-NAME: prints the context id or "absent". Read-only.
preflight_circleci() {
  local id
  id=$(cci_items "context?owner-id=$CIRCLECI_ORG_ID" | jq -r --arg n "$1" 'select(.name == $n) | .id' | head -n1)
  if [ -z "$id" ]; then echo absent; return 0; fi
  local vars has
  # Not inside a condition: errexit must stay on, so a failed lookup ends the run.
  vars=$(cci_items "context/$id/environment-variable")
  has=$(jq -s 'any(.[]; .variable == "SOPS_AGE_KEY")' <<<"$vars")
  if [ "$has" = true ] && [ "$ROTATE" != 1 ]; then
    die "CircleCI context $1 already has SOPS_AGE_KEY; refusing to replace it without --rotate"
  fi
  echo "$id"
}

restrictions() { # ID: sorted "type value" lines of every restriction on the context
  local body
  body=$(cci GET "context/$1/restrictions")
  jq -r '(.items // .restrictions // [])[] | "\(.restriction_type) \(.restriction_value)"' <<<"$body" | sort
}

# setup_circleci NAME ID PROJECT-ID: create the context if needed, apply and read back both
# restrictions; prints the context id.
setup_circleci() {
  local id=$2
  if [ "$id" = absent ]; then
    id=$(jq -cn --arg n "$1" --arg o "$CIRCLECI_ORG_ID" '{name: $n, owner: {id: $o, type: "organization"}}' |
      cci POST context | jq -r '.id // empty')
    [ -n "$id" ] || die "could not create CircleCI context $1"
  fi
  local want have
  want=$(printf '%s\n' "expression $MAIN_EXPR" "project $3" | sort)
  have=$(restrictions "$id")
  # Restrictions of one type are OR'd: any other restriction would widen access, so refuse it.
  while IFS= read -r line; do
    [ -z "$line" ] || grep -qxF -- "$line" <<<"$want" ||
      die "context $1 has an extra restriction '$line'; it must have exactly the project and main-branch restrictions. No key was stored"
  done <<<"$have"
  if ! grep -qxF -- "project $3" <<<"$have"; then
    jq -cn --arg p "$3" '{project_id: $p, restriction_type: "project", restriction_value: $p}' |
      cci POST "context/$id/restrictions" >/dev/null
  fi
  if ! grep -qxF -- "expression $MAIN_EXPR" <<<"$have"; then
    jq -cn --arg e "$MAIN_EXPR" '{restriction_type: "expression", restriction_value: $e}' |
      cci POST "context/$id/restrictions" >/dev/null
  fi
  local raw
  raw=$(cci GET "context/$id/restrictions")
  have=$(jq -r '(.items // .restrictions // [])[] | "\(.restriction_type) \(.restriction_value)"' <<<"$raw" | sort)
  [ "$have" = "$want" ] ||
    die "context $1 does not show exactly the project and main-branch restrictions; no key was stored. Fix them in Organization settings > Contexts and re-run. API read-back: $(jq -c . <<<"$raw" 2>/dev/null || printf '%s' "$raw")"
  echo "$id"
}

# --- main -----------------------------------------------------------------------------------

main() {
  local dir="" push=0 owners=() consumers=() bundles=()
  ROTATE=0
  ALLOW_APPS=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --self-test) self_test; return ;;
      --check-rulesets)
        # Read-only: every repo after the flag must have the release-tag ruleset (§0 P2).
        shift
        while [ "${1:-}" = --allow-app ]; do
          [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--allow-app needs a numeric GitHub App id"
          ALLOW_APPS+="${ALLOW_APPS:+,}$2"
          shift 2
        done
        [ $# -ge 1 ] || die "--check-rulesets needs OWNER/REPO arguments"
        need gh; need jq
        TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
        local bad=0 st
        for repo in "$@"; do
          st=$(tag_ruleset "$repo")
          echo "tag ruleset $repo: $st"
          [ "$st" = ok ] || bad=1
        done
        [ "$bad" = 0 ] || die "release-tag ruleset missing or unreadable; see spec §0 P2"
        return ;;
      --secrets-dir) dir=$2; shift ;;
      --owner-pub) owners+=("$2"); shift ;;
      --consumer) consumers+=("$2"); shift ;;
      --bundle) bundles+=("$2"); shift ;;
      --push) push=1 ;;
      --allow-app)
        [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--allow-app needs a numeric GitHub App id"
        ALLOW_APPS+="${ALLOW_APPS:+,}$2"; shift ;;
      --rotate) ROTATE=1 ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done

  # Phase 1: validate.
  [ -d "$dir/.git" ] || die "--secrets-dir must be a clone of the secrets repo"
  [ ${#owners[@]} -ge 1 ] || die "need at least one --owner-pub"
  [ ${#consumers[@]} -ge 1 ] || die "need at least one --consumer"
  [ ${#bundles[@]} -ge 1 ] || die "need at least one --bundle"
  local o re_pub='^age1[02-9ac-hj-np-z]{58}$'
  for o in "${owners[@]}"; do
    case "$o" in AGE-SECRET-KEY-*) die "--owner-pub got a PRIVATE key; pass the age1... public key (age-keygen -y)" ;; esac
    [[ "$o" =~ $re_pub ]] || die "--owner-pub is not an age public key (expected age1 + 58 characters)"
  done
  check_tools; need gh; self_test >/dev/null
  TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
  SECRETS_DIR=$dir

  local c repo env prov proj name i n
  local -a c_repo=() c_env=() c_prov=() c_proj=() c_name=() c_state=()
  for c in "${consumers[@]}"; do
    IFS=: read -r repo env prov proj <<<"$c"
    [[ "$repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ && "$env" =~ ^[a-z0-9-]+$ ]] || die "bad --consumer $c"
    case "$prov" in
      github) [ -z "$proj" ] || die "bad --consumer $c (github takes no project id)" ;;
      circleci)
        [[ "$proj" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
          die "bad --consumer $c (circleci needs :<project-id>, a UUID from Project settings > Overview)"
        [ -n "${CIRCLECI_TOKEN:-}" ] && [ -n "${CIRCLECI_ORG_ID:-}" ] || die "set CIRCLECI_TOKEN and CIRCLECI_ORG_ID"
        need curl ;;
      *) die "bad --consumer $c (provider must be github or circleci)" ;;
    esac
    name="${repo#*/}-$env"
    for i in "${!c_name[@]}"; do [ "${c_name[$i]}" != "$name" ] || die "duplicate consumer $name"; done
    c_repo+=("$repo"); c_env+=("$env"); c_prov+=("$prov"); c_proj+=("$proj"); c_name+=("$name")
  done

  local b spec only path keys e k members repos found
  local -a b_path=() b_keys=() b_members=()
  for b in "${bundles[@]}"; do
    spec=${b%%@*}; only=""; [ "$spec" = "$b" ] || only=${b#*@}
    path=${spec%%=*}; keys=${spec#*=}; e=${path%%/*}
    [[ "$path" =~ ^[a-z0-9-]+/[a-z0-9._-]+$ && -n "$keys" && "$keys" != "$spec" ]] || die "bad --bundle $b"
    for k in ${keys//,/ }; do [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "bad key $k in --bundle $b"; done
    for path_seen in "${b_path[@]}"; do [ "$path_seen" != "$path" ] || die "duplicate --bundle $path"; done
    members=""
    if [ -n "$only" ]; then
      for n in ${only//,/ }; do
        found=""
        for i in "${!c_name[@]}"; do
          if [ "${c_name[$i]}" = "$n" ] && [ "${c_env[$i]}" = "$e" ]; then found=$i; fi
        done
        [ -n "$found" ] || die "--bundle $b names $n, which is not a consumer of env $e"
        members+="$found "
      done
    else
      repos=""
      for i in "${!c_env[@]}"; do
        if [ "${c_env[$i]}" = "$e" ]; then members+="$i "; repos+="${c_repo[$i]}"$'\n'; fi
      done
      [ -n "$members" ] || die "no consumer of env $e for bundle $path"
      [ "$(printf '%s' "$repos" | sort -u | wc -l | tr -d ' ')" -eq 1 ] ||
        die "env $e has consumers in several repos; name them in --bundle $path=...@<names>"
    fi
    b_path+=("$path"); b_keys+=("$keys"); b_members+=("$members")
  done

  # Phase 2: preflight (read-only).
  if [ -e "$dir/access.toml" ] && [ "$ROTATE" != 1 ]; then
    die "$dir/access.toml exists: this repo was bootstrapped already. Use hoist secrets grant, or --rotate"
  fi
  if [ "$ROTATE" = 1 ] && [ -e "$dir/access.toml" ]; then
    # Every recipient of the old access.toml must be given again, or it would lose access silently.
    local old want_names r
    want_names=$(for i in "${!owners[@]}"; do echo "owner-$((i + 1))"; done; printf '%s\n' "${c_name[@]}")
    old=$(awk '/^\[\[recipient\]\]/ {r=1; next} /^\[/ {r=0} r && /^name = / {gsub(/^name = "|"$/, ""); print}' "$dir/access.toml")
    while IFS= read -r r; do
      [ -n "$r" ] || continue
      grep -qxF -- "$r" <<<"$want_names" ||
        die "--rotate: recipient $r in access.toml is not given again; pass it or use hoist secrets rotate-key"
    done <<<"$old"
  fi
  if [ "$ROTATE" = 1 ]; then
    local f files listed old_keys ok
    # Not a process substitution: a failing find must end the run (errexit + pipefail).
    files=$(cd "$dir" && find . -name '*.sops.yaml' -not -path './.git/*' | sort)
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      listed=""
      for j in "${!b_path[@]}"; do if [ "./${b_path[$j]}.sops.yaml" = "$f" ]; then listed=$j; fi; done
      [ -n "$listed" ] || die "--rotate: $f is not listed as --bundle; it would stay encrypted to old keys"
      # Key names are plaintext in sops YAML: every old key must be listed again, or its value is lost.
      old_keys=$(awk '/^[A-Za-z_][A-Za-z0-9_]*:/ { k = $1; sub(/:$/, "", k); if (k != "sops") print k }' "$dir/$f")
      while IFS= read -r k; do
        [ -n "$k" ] || continue
        ok=""
        for kk in ${b_keys[$listed]//,/ }; do if [ "$kk" = "$k" ]; then ok=1; fi; done
        [ -n "$ok" ] || die "--rotate: key $k of $f is not listed in --bundle ${b_path[$listed]}=...; its value would be lost"
      done <<<"$old_keys"
    done <<<"$files"
  fi
  for i in "${!c_name[@]}"; do
    if [ "${c_prov[$i]}" = github ]; then
      c_state[$i]=$(preflight_github "${c_repo[$i]}" "${c_env[$i]}")
    else
      c_state[$i]=$(preflight_circleci "${c_name[$i]}")
    fi
  done

  # Phase 3: collect values (memory only).
  local -a b_json=()
  local val json j
  for j in "${!b_path[@]}"; do
    json="{"
    for k in ${b_keys[$j]//,/ }; do
      IFS= read -rsp "value for ${b_path[$j]}#$k (one line): " val || die "no value for ${b_path[$j]}#$k"
      echo >&2
      [ -n "$val" ] || die "empty value for ${b_path[$j]}#$k"
      json+="\"$k\":$(printf '%s' "$val" | jq -Rs .),"
      val=""
    done
    b_json+=("${json%,}}")
  done

  # Phase 4a: environments and contexts (with restrictions) for every consumer, before any key.
  for i in "${!c_name[@]}"; do
    if [ "${c_prov[$i]}" = github ]; then
      setup_github "${c_repo[$i]}" "${c_env[$i]}" "${c_state[$i]}"
    else
      c_state[$i]=$(setup_circleci "${c_name[$i]}" "${c_state[$i]}" "${c_proj[$i]}")
    fi
  done

  # Phase 4b: one key per consumer, stored via stdin; then the files.
  local key pub exp access sops_yaml recips names
  local -a c_pub=()
  exp=$(expires_date)
  STORED=""
  STAGE=keys
  trap 'rc=$?; rm -rf "$TMPD"
    if [ "$rc" -ne 0 ] && [ "$STAGE" = pushing ]; then
      echo "bootstrap-secrets: keys are stored and the files are committed; only the push failed: run git -C \"$SECRETS_DIR\" push" >&2
    elif [ "$rc" -ne 0 ] && [ -n "$STORED" ]; then
      echo "bootstrap-secrets: keys were already stored for:$STORED; fix the error and re-run with --rotate" >&2
    fi' EXIT
  for i in "${!c_name[@]}"; do
    key=$(age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-')
    pub=$(printf '%s\n' "$key" | age-keygen -y)
    if [ "${c_prov[$i]}" = github ]; then
      printf '%s' "$key" | gh secret set SOPS_AGE_KEY --env "${c_env[$i]}" --repo "${c_repo[$i]}"
    else
      printf '%s' "$key" | jq -cRs '{value: .}' |
        cci PUT "context/${c_state[$i]}/environment-variable/SOPS_AGE_KEY" >/dev/null
    fi
    key=""
    c_pub[$i]=$pub
    STORED+=" ${c_name[$i]}"
  done

  access="version = 1"$'\n'
  for i in "${!owners[@]}"; do
    access+=$'\n'"[[recipient]]"$'\n'"name = \"owner-$((i + 1))\""$'\n'"kind = \"human\""$'\n'"age = \"${owners[$i]}\""$'\n'"expires = \"$exp\""$'\n'
  done
  for i in "${!c_name[@]}"; do
    access+=$'\n'"[[recipient]]"$'\n'"name = \"${c_name[$i]}\""$'\n'"kind = \"ci\""$'\n'"repo = \"${c_repo[$i]}\""$'\n'"env = \"${c_env[$i]}\""$'\n'"provider = \"${c_prov[$i]}\""$'\n'"age = \"${c_pub[$i]}\""$'\n'"expires = \"$exp\""$'\n'
  done
  sops_yaml="creation_rules:"
  local -a written=()
  for j in "${!b_path[@]}"; do
    path=${b_path[$j]}; e=${path%%/*}
    names=$(printf '"owner-%s", ' $(seq 1 ${#owners[@]}))
    recips=$(IFS=,; echo "${owners[*]}")
    for i in ${b_members[$j]}; do names+="\"${c_name[$i]}\", "; recips+=",${c_pub[$i]}"; done
    access+=$'\n'"[[rule]]"$'\n'"path = \"$path.sops.yaml\""$'\n'"recipients = [${names%, }]"$'\n'
    sops_yaml+=$'\n'"  - path_regex: ^${path//./\\.}\\.sops\\.yaml\$"$'\n'"    age: $recips"
    mkdir -p "$dir/$e"
    # Temp file in the same dir, then mv: a failed encryption never leaves a half-written bundle.
    if ! printf '%s' "${b_json[$j]}" | encrypt_json "$path.sops.yaml" "$recips" > "$dir/$path.sops.yaml.tmp"; then
      rm -f "$dir/$path.sops.yaml.tmp"
      die "encrypting $path.sops.yaml failed; that file was not changed"
    fi
    mv -f "$dir/$path.sops.yaml.tmp" "$dir/$path.sops.yaml"
    b_json[$j]=""
    written+=("$path.sops.yaml")
  done
  # `a && b` would hide a failed write from errexit; fail explicitly instead.
  printf '%s' "$access" > "$dir/access.toml.tmp" || die "writing access.toml failed; nothing was committed"
  printf '%s\n' "$sops_yaml" > "$dir/.sops.yaml.tmp" || die "writing .sops.yaml failed; nothing was committed"
  mv -f "$dir/access.toml.tmp" "$dir/access.toml"
  mv -f "$dir/.sops.yaml.tmp" "$dir/.sops.yaml"

  local scan=0
  grep -rq 'AGE-SECRET-KEY-' "$dir" --exclude-dir=.git || scan=$?
  case "$scan" in
    1) ;;
    0) die "a private key reached the repo dir; nothing was committed" ;;
    *) die "could not scan $dir for private keys (grep exit $scan); nothing was committed" ;;
  esac
  if [ "$push" = 1 ]; then
    git -C "$dir" add -- access.toml .sops.yaml "${written[@]}"
    git -C "$dir" commit -qm "chore: bootstrap secrets (owner)" -- access.toml .sops.yaml "${written[@]}"
    STAGE=pushing
    git -C "$dir" push -q
    STAGE=done
  fi
  echo "--- paste into the chat (public data only) ---"
  echo "secrets repo: $(git -C "$dir" remote get-url origin 2>/dev/null | sed -E 's#(://)[^/@]*@#\1#' || true) @ $(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo "(no commit)")"
  for i in "${!c_name[@]}"; do echo "consumer ${c_env[$i]} ${c_name[$i]} ${c_prov[$i]} ${c_pub[$i]}"; done
  # Informational here (P2 may come after C5); --check-rulesets fails when one is missing.
  printf '%s\n' "${c_repo[@]}" | sort -u | while IFS= read -r repo; do
    # stderr silenced: a missing ruleset is expected here and must not look like a failed bootstrap.
    echo "tag ruleset $repo: $(tag_ruleset "$repo" 2>/dev/null) (info only: needed before any release; check with --check-rulesets, spec §0 P2)"
  done
  printf 'file %s\n' access.toml .sops.yaml "${written[@]}"
  echo "no private key in the repo dir: ok"
}

main "$@"
