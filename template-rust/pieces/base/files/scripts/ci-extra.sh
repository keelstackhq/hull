#!/usr/bin/env bash
# Repo-specific CI checks. CI runs this last, as `bash scripts/ci-extra.sh`, only when the change
# is not docs-only or unaffected. Keep it fast; a non-zero exit fails CI. Delete the file to opt out.
set -euo pipefail
