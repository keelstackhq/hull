#!/usr/bin/env bash
# Repo-specific CI prelude. CI runs this early, as `bash scripts/ci-pre.sh`, right after the
# affected check and before install/build, only when the change is not docs-only or unaffected.
# Use it for disk cleanup. A non-zero exit fails CI. Delete the file to opt out.
set -euo pipefail
