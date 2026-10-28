#!/bin/sh
# Prints the TURBO_SCM_BASE for CircleCI (secrets-ci design §6.4).
#   gh-readonly-queue/<base>/pr-<n>-<sha>  -> <sha> (40 lowercase hex, else exit 1)
#   default branch                         -> $1 (pipeline.git.base_revision); when empty (the
#                                             branch's first pipeline, API or scheduled runs),
#                                             the parent commit
#   anything else                          -> git merge-base HEAD origin/<default>
# Usage: scm-base.sh <base_revision> ; env: CIRCLE_BRANCH, DEFAULT_BRANCH (default: main)
# The branch name is chosen by whoever pushed it: it is never printed or passed to git.
set -eu
branch="${CIRCLE_BRANCH:-}"
default="${DEFAULT_BRANCH:-main}"
hex40() {
  case "$1" in "" | *[!0-9a-f]*) return 1 ;; esac
  [ "${#1}" -eq 40 ]
}
case "$branch" in
  gh-readonly-queue/*/pr-*-*)
    sha="${branch##*-}"
    hex40 "$sha" || { echo "scm-base: merge queue branch does not end in a commit sha" >&2; exit 1; }
    printf '%s\n' "$sha"
    ;;
  "$default")
    base="${1:-}"
    if [ -z "$base" ]; then
      git rev-parse --verify --quiet "HEAD^" || { echo "scm-base: no base revision and no parent commit" >&2; exit 1; }
    else
      case "$base" in *[!0-9a-f]*) echo "scm-base: base revision is not a commit sha" >&2; exit 1 ;; esac
      printf '%s\n' "$base"
    fi
    ;;
  *)
    git merge-base HEAD "origin/$default"
    ;;
esac
