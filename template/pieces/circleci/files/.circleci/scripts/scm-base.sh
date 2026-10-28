#!/bin/sh
# Prints the TURBO_SCM_BASE for CircleCI (secrets-ci design §6.4).
#   gh-readonly-queue/<base>/pr-<n>-<sha>  -> <sha> when it is 40 lowercase hex, on origin/<default>,
#                                             an ancestor of HEAD and not HEAD (anyone can push a
#                                             branch with that name); otherwise (forged, or the base
#                                             of a stacked queue group, which is the previous
#                                             entry's commit and not on <default> yet) the
#                                             merge-base below: an honest superset diff
#   default branch                         -> $1 (pipeline.git.base_revision, 40 hex); when empty (the
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
    # The queue base is a default-branch commit, which a PR author cannot create; a forged
    # name can then only yield an honest diff from a default-branch commit.
    if hex40 "$sha" &&
      git merge-base --is-ancestor "$sha" "origin/$default" 2>/dev/null &&
      git merge-base --is-ancestor "$sha" HEAD 2>/dev/null &&
      [ "$sha" != "$(git rev-parse HEAD)" ]; then
      printf '%s\n' "$sha"
    else
      git merge-base HEAD "origin/$default"
    fi
    ;;
  "$default")
    base="${1:-}"
    if [ -z "$base" ]; then
      git rev-parse --verify --quiet "HEAD^" || { echo "scm-base: no base revision and no parent commit" >&2; exit 1; }
    else
      hex40 "$base" || { echo "scm-base: base revision is not a commit sha" >&2; exit 1; }
      printf '%s\n' "$base"
    fi
    ;;
  *)
    git merge-base HEAD "origin/$default"
    ;;
esac
