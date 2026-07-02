# Pre-PR Checklist

> Walk through this list before running `gh pr create`. The CI lint+test gates won't catch these — they require human judgment.

## 1. Breaking Change Review

- [ ] **DB schema** — new column NOT NULL? Backfill plan? Migration tested on a copy of prod-sized data?
- [ ] **API surface** — request/response shape change? Old clients still compile / parse / route correctly?
- [ ] **Proto field reservation** — removed any proto field? `reserved <number>` + `reserved "<name>"` added?
- [ ] **Public exports** — removed any exported function / type / constant? Search for external callers (other repos, IDE plugins, CLI consumers)
- [ ] **Config flags** — renamed / removed any env var or flag? Migration path documented?

## 2. Data Safety

- [ ] **Composite-PK predicates** (if applicable) — every WHERE / JOIN / DELETE / UPDATE on composite-PK tables includes ALL PK columns (not just `id`)
- [ ] **Index coverage** — new WHERE / ORDER BY paths backed by an index? EXPLAIN ANALYZE checked for the slow-path query?
- [ ] **N+1 queries** — any new loop calling the DB? Batched / joined?
- [ ] **Audit log** — every write operation records actor + action + target + timestamp + result

## 3. Security

- [ ] **No hardcoded secrets** — no API keys, passwords, tokens in source. Use env vars / secret manager
- [ ] **SQL injection** — all SQL uses prepared statements; no string concatenation of user input
- [ ] **Authn / authz** — new endpoint goes through the auth interceptor? Permission check at the right layer?
- [ ] **Input validation** — proto `[(buf.validate.field)]` annotations or equivalent for user-supplied fields

## 4. Test / Lint Gates

- [ ] **Format** — formatter ran (gofmt / cargo fmt / prettier)
- [ ] **Lint** — `golangci-lint run` (or equivalent) exits clean
- [ ] **Unit tests** — new logic covered; existing tests still pass
- [ ] **Integration tests** — wired up if module is in the "security-sensitive" set (auth / approval / audit / billing)
- [ ] **Type check** — frontend `pnpm type-check` exits clean
- [ ] **Build** — full production build still works (`make build` / `cargo build --release`)

## 5. Docs

- [ ] **Module spec** — `docs/modules/<module>.md` updated if behavior changed
- [ ] **Changelog entry** — if applicable
- [ ] **MODULES.md status** — flipped to ✅ if this completes a module
- [ ] **README** — only if user-visible setup changed

## 6. PR Hygiene

- [ ] **PR title** matches `<type>(<scope>): <description>` (e.g. `feat(risk): add CEL evaluator`)
- [ ] **PR body** describes: purpose, changes, test plan, impact scope
- [ ] **Linked issues / tickets** referenced
- [ ] **Screenshots** for UI changes
- [ ] **No `--no-verify`** used to bypass git hooks
- [ ] **No force-push** to main / dev branches

## 7. Smoke Test (manual)

- [ ] **Golden path** — happiest user flow still works end-to-end
- [ ] **Edge cases** — empty input / largest expected input / non-ASCII / null-handling
- [ ] **Regression scan** — adjacent features not broken (run through the 3 closest features in the same module)
