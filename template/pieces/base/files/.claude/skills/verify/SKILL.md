---
name: verify
description: Run lint, format check, typecheck and tests on the packages changed since the base branch and report a short pass/fail summary. Use before claiming any work is done.
---

Run:

```bash
pnpm turbo run lint format:check typecheck test --affected --output-logs=errors-only
```

Report at most 10 lines: pass or fail per task, and for each failure the first error only (file,
line, message). If everything passed, say so in one line. Never report a pass you did not see in
the output. Do not fix anything unless asked.
