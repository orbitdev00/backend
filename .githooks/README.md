# Git hooks

Version-controlled hooks for this repo.

## Enable (one time, per clone)

```sh
git config core.hooksPath .githooks
```

That's it — Git will now run `.githooks/pre-commit` before every commit.

## What `pre-commit` blocks

1. **UTF-8 BOM** at the start of any staged text file (this repo has had
   recurring BOM corruption, e.g. `backend/main.py`).
2. **Live secrets** staged for commit — Anthropic keys (`sk-ant-…`), Stripe
   keys (`sk_live_…`, `whsec_…`), GitHub tokens (`ghp_…`, `github_pat_…`),
   Resend keys (`re_…`).

Placeholder values in `*.example` files (e.g. `sk-ant-your-key-here`) are safe
and won't trip the check.

## Bypass (rare, deliberate)

```sh
git commit --no-verify
```
