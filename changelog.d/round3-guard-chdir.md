- Guard: `env -C/--chdir`, `tar -C`, `make -C`, `git --work-tree=`, `--prefix` and a `cd` with glob
  characters that expands to a guarded dir are treated like `cd`. `git diff > x.diff && git apply -R x.diff`
  is allowed (a patch the chain generated from the repo); a patch file any other command of the chain wrote
  is still refused. Protected-path denies say to use paths from the repo root.
