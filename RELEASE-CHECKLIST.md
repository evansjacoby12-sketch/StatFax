# Release checklist

- [ ] `git status --short` reviewed; unrelated user files excluded.
- [ ] `npm run doctor -- --offline` passes.
- [ ] `npm run mlb:audit` passes.
- [ ] `npm test` passes.
- [ ] `npm --prefix ui run smoke` passes.
- [ ] `npm --prefix ui run build` passes.
- [ ] Worker dry-run passes when Worker code changed.
- [ ] Production scoring changes include held-out/prospective evidence and update `MODEL-DECISIONS.md`.
- [ ] No credentials or generated `dist` files were staged accidentally.
- [ ] Commit pushed to `main` and GitHub production workflow succeeds.
- [ ] `npm run doctor` confirms site/R2 freshness, publish parity, Worker health, and latest workflow.
- [ ] Release tag points to the verified commit.
- [ ] Provider-side API budgets/alerts and account recovery methods were reviewed manually.
