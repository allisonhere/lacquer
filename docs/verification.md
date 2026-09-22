# Current verification — Milestone 4

Verified on 2026-09-08. The [Milestone 4 handoff](handoff-milestone-4.md) is the
current record. All 100 unit tests, 60 integration tests, and all three browser
journeys pass. Lint, typecheck, build, focused Milestone 3 concurrency/idempotency,
and 12 focused timezone/DST checks pass. All four migrations applied to a new
disposable test database, which was removed after verification. Existing records
below describe earlier milestones rather than the current scope.

# Historical verification — Milestone 3

The 2026-09-07 verification results are recorded in [the Milestone 3 handoff](handoff-milestone-3.md). All 96 unit tests and 51 integration tests pass, along with lint, typecheck, and build. PostgreSQL and Redis Compose startup and fresh-database migrations succeeded. The earlier results below are historical Milestone 1/2 records.

The subsequent local preview setup also succeeded: `pnpm db:migrate`,
`pnpm db:seed`, and `pnpm dev`. An HTTP check of
`http://localhost:5173/login` succeeded and the page was opened in the browser.
This does not add a browser sign-in test to the automated results above. See the
handoff for restart instructions and demo credentials.

# Verification

Commands actually executed in the implementation environment, with their
results. Nothing below is aspirational.

## Milestone 1

Recorded when the foundation was built: lint, format, typecheck, unit tests,
build, integration tests against real PostgreSQL and Redis, and the Playwright
smoke flow. All passed.

## Milestone 2

Environment: Node 26.7.0, pnpm 10.30.3, PostgreSQL 17 and Redis 7 reachable on
`127.0.0.1:5432` and `127.0.0.1:6379`.

### Successful commands and checks

```sh
pnpm install --frozen-lockfile          # lockfile already satisfied
pnpm lint                               # clean
pnpm format:check                       # clean
pnpm typecheck                          # 9 packages, 0 errors
pnpm test                               # 7 files, 66 unit tests passed
pnpm build                              # all packages, web artifact built
pnpm test:integration                   # 2 files, 32 tests passed
pnpm --filter @lacquer/db migrate       # applied 0001 to lacquer and lacquer_test
pnpm --filter @lacquer/db seed          # run twice; row counts identical
pnpm exec playwright test               # 2 specs passed
```

Migration `0001_legal_energizer.sql` was applied to a database already carrying
Milestone 1 data, and separately to `lacquer_test`. The up-path is valid on a
populated database; no earlier migration was edited.

Database-level guarantees were checked directly with `psql` rather than trusted
from the schema definition:

- inserting a `staff_location_assignments` row joining one salon's technician to
  another salon's location is rejected by
  `staff_location_assignments_location_fk`
- a negative `services.base_price` is rejected by
  `services_base_price_non_negative`
- a `staff_schedule_blocks` row with `start_minute >= end_minute` is rejected by
  `staff_schedule_blocks_bounds`

The seed was run twice in succession; the demo salon still held exactly 2 staff,
2 locations, 4 categories, 4 services, 3 variants, 3 add-ons, 5 skills, 12
schedule blocks, 1 time-off record, 2 availability overrides, and 1 technician
service override.

### Failed attempts and corrections

- **Migration ordering.** `drizzle-kit generate` emitted
  `ALTER TABLE locations ADD CONSTRAINT locations_id_tenant_unique` as the final
  statement, after the composite foreign keys that reference it, so the first
  `migrate` failed with "there is no unique constraint matching given keys".
  The statement was moved to the head of the file. The migration had never been
  applied anywhere, so editing it was safe.
- **DST gap resolution.** The first `zonedWallClockToUtc` used the usual
  two-pass offset estimate. Its own test caught that 02:30 on a spring-forward
  day resolved _backwards_ to 01:30. It now derives two candidates, keeps the
  one that round-trips, and resolves a gap forward and an overlap to the first
  occurrence.
- **Zod 4 schema composition.** `.refine()` returns a `ZodObject` rather than a
  wrapper, so `.innerType()` does not exist and `.partial()` drops refinements.
  Create, patch, and response schemas are now all derived from a shared base
  object with cross-field rules attached separately.
- **Schedule editor discarded unsaved edits.** The editor rebuilt its draft from
  props whenever the parent refetched, so a background reload wiped a half-typed
  week. It now compares the saved schedule by content and never rebuilds while
  edits are pending. Found by the browser suite.
- **Accessible names absorbed hint text.** Several new fields wrapped both the
  input and its hint in one `<label>`, making the accessible name include the
  hint. Explicit `aria-label`s were added. The schedule editor's Remove button
  was also reworded, since "Remove Monday work starting 09:00" contained the
  time field's own name.
- **Success notice appeared before its reload finished.** `act()` announced
  success between the write and the refetch, so a follow-up action could start
  against a panel that was about to be replaced. The notice now appears only
  after the reload settles.

### Environment notes

- The default Compose ports were already held by a previously started stack, so
  `playwright.config.ts` now reads `E2E_API_PORT` / `E2E_WEB_PORT` and passes
  matching `APP_URL`/`ORIGIN`/`API_INTERNAL_URL` to the servers it starts. Both
  specs were run on alternate ports.
- `RATE_LIMIT_MAX` was introduced (default 120, unchanged) because a whole
  browser suite — or a busy front desk behind one NAT address — legitimately
  exceeds the previously hardcoded ceiling.

## Unverified / remaining limitations

- **Docker Compose was not started.** The Docker daemon is not accessible to
  the current user in this environment (`permission denied` on
  `/var/run/docker.sock`; the account is not in the `docker` group).
  `docker compose config` parses `compose.yml` successfully and all six
  services resolve, but `docker compose up --build` was not executed. Postgres
  and Redis were reached directly instead.
- The public booking flow, availability search, and appointment behaviour do
  not exist and are not tested; that is Milestone 3.
- Automatic breaks, daily technician limits, double-booking modes, and service
  prerequisites are stored and served but deliberately not enforced.
- Browser coverage is a single end-to-end journey plus the Milestone 1 smoke
  flow, not exhaustive visual testing.
