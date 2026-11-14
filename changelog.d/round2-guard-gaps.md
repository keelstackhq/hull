- Guard: `cd`/`pushd`/`git -C` into a guarded dir, a persisted `cwd` inside one, `patch` / `git apply`
  of a diff that names a protected path (or piped, unreadable input) and `find -exec sh -c '<publish>'`
  no longer bypass the rail. Allowed: `git apply` or `patch` from a readable diff that touches other files.
- `scripts/ready.mjs`: one `details` line instead of a `see:` line per item (less output per session).
