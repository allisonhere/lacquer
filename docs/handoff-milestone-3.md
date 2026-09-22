# Milestone 3 handoff

Historical record. Milestone 4 has since added public booking; see the [current handoff](handoff-milestone-4.md).

Completed and verified on 2026-09-07 after recovering the interrupted workspace.
Milestone 4 has not started. See [booking-engine.md](booking-engine.md) for the
schema, availability pipeline, schedule order, timezone/DST policy, half-open
conflicts, buffers, limits, automatic breaks, intelligent overlap, lifecycle, and
all seven APIs. See [concurrency.md](concurrency.md) for transaction boundaries,
locking, and idempotency.

## Resume locally

The development database was migrated with `pnpm db:migrate` and populated with
`pnpm db:seed` after the test verification. Both commands succeeded. `pnpm dev`
was then launched for web, API, and worker; the sign-in URL responded successfully
and was opened in the browser. This was a page-availability check, not a new
browser authentication test.

- Sign in: <http://localhost:5173/login>
- Demo owner: `owner@example.test` / `Development-only-123!`
- Select **Lacquer Demo Salon** after signing in.
- API documentation: <http://localhost:3001/docs/>

PostgreSQL/Redis containers and the local development processes were left running
at handoff. Development processes may need restarting after the agent session or
a reboot. From the repository root, with the existing `.env`:

```sh
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Use the existing `.env`; do not overwrite it with `.env.example`. Tests use the
separate `lacquer_test` database and Redis database 15. The application uses the
development database. Booking is available through the staff API; the existing
web screens cover salon operations, without an appointment calendar or booking UI.

## Next developer

Read this handoff, then `booking-engine.md` and `concurrency.md`. Inspect
`git status` before editing: recovered Milestone 2 and Milestone 3 work is still
uncommitted. The completed scope stops at Milestone 3; obtain the next milestone's
requirements before extending the product. For booking changes, preserve the
invariants below and rerun the recorded checks, especially the real concurrency,
idempotency, tenant-isolation, and DST tests.

## Verification actually performed

| Command/check                                                                 | Result                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                   | Passed after fixing two unused variables                                                                            |
| `pnpm typecheck`                                                              | Passed, all workspace packages and root TypeScript                                                                  |
| `pnpm test`                                                                   | 96 passed in 8 files                                                                                                |
| `pnpm test:integration`                                                       | 51 passed: 14 foundation, 19 salon operations, 18 booking                                                           |
| `pnpm build`                                                                  | Passed, including web production build                                                                              |
| `pnpm test:integration apps/api/src/booking.integration.test.ts -t mandatory` | Concurrency and idempotency both passed                                                                             |
| `docker compose config` and `docker compose config --quiet`                   | Passed                                                                                                              |
| `docker info --format '{{.ServerVersion}}'`                                   | Docker 29.7.2 accessible outside sandbox                                                                            |
| `docker compose up -d postgres redis`                                         | Both started; fresh Compose volumes created                                                                         |
| Clean test database migrations                                                | Integration setup applied 0000, 0001, 0002 to the freshly initialized `lacquer_test`; subsequent suites reused them |
| `git diff --check`                                                            | Passed                                                                                                              |

The focused timezone command actually run was:

```sh
pnpm exec vitest run packages/booking-engine/src/time.test.ts packages/booking-engine/src/availability.test.ts -t 'DST|spring|fall|local'
```

It passed 12 tests, with 33 unrelated cases skipped. The full unit run also passed.

Focused files were formatted with `pnpm exec prettier --write`. No Playwright
expansion or browser run was needed. Full application Compose image build/startup
was not run; live Compose verification covers PostgreSQL and Redis only. Those
containers remain running. PostgreSQL emitted harmless identifier-truncation
notices for generated long constraint names; migrations completed successfully.

## Release-critical evidence

The two-create race observes both real PostgreSQL transactions waiting on the
production advisory lock before release. Exactly one returns 201, exactly one
returns safe 409 `SLOT_UNAVAILABLE`, and one appointment exists. Concurrent
idempotent retries return one ID; incompatible payload reuse returns conflict.
Concurrent different-slot booking respects the daily cap. A reschedule racing a
create admits only one claim of the destination and preserves the old appointment
if the move loses.

The existing salon-operations tenant-isolation suite now checks foreign appointment
view/reschedule/cancel through both foreign-tenant and substituted-resource paths,
foreign staff/service availability searches, foreign-location creation, and a
composite-FK database backstop. All pass. DST tests cover ordinary dates,
spring-forward, fall-back, 09:00 local stability, skipped nonexistent starts, and
first-occurrence ambiguity handling.

Unit coverage includes interval boundaries, containment, buffers, split shifts,
recurring breaks, partial/full-day/cancelled time off, added/removed availability,
notice/horizon, appointment/minute caps, automatic-break chains, and all overlap
modes. Existing pricing, null-versus-zero, eligibility, money, and time tests pass.
Booking integration coverage additionally checks snapshots, variant/add-on totals,
technician overrides, cancellation, rescheduling, deterministic any-available
selection, permissions, manual-override auditing, pagination, and OpenAPI.

## Failures found and fixed

- Redis connection failures after the reboot: started the project test services
  using the accessible Docker daemon; reran the complete suite successfully.
- Two lint failures: removed the unused import and explicitly discarded the
  derived add-on total when persisting normalized snapshots.
- Manual overrides could overlap a technician at different locations: added an
  unconditional cross-location guard and regression coverage.
- The recovered concurrency test released its gate without proving both requests
  had reached PostgreSQL: added observed waiting-lock assertions. Fixed overflow
  and OID casting errors in that test query; focused and full runs now pass.
- Stale documentation claimed booking did not exist: updated README and handoff,
  and added focused booking/concurrency documents.

## Limits and future invariants

One technician and location per appointment; rescheduling changes time while
preserving them and all snapshots. Clients remain null. Service prerequisites
remain stored only. No public booking, payment, CRM, calendar UI, or later product
features are included. Search is limited to 31 local dates. Fall-back exposes only
the first repeated local start. Daily accounting uses the candidate location's
local date. Automatic workload counts service/processing/add-ons, not buffers.

The tenant-wide lock favors correctness over throughput. All future booking
writers must follow it; direct SQL is not protected by advisory locks. Schedule
and catalog administration can change configuration independently, without
retroactively changing snapshots. Batch loading currently reads all booked
appointments in the tenant; future optimization must preserve cross-location
conflicts and complete automatic-break chains. Idempotency keys persist and
return the appointment's current state on retries.

Milestone 4 must preserve composite tenant FKs/404 substitution, integer money,
null/zero inheritance, existing eligibility/pricing/time helpers, local recurring
schedules, historical snapshots, half-open buffered occupancy, cancellation
capacity release, atomic rescheduling, audited manual overrides, and the real
concurrency/idempotency/isolation tests.

## Git/workspace state

No commit was made. The workspace already contained uncommitted Milestone 2 and
partial Milestone 3 work on recovery; it was preserved. Final status has 63 file
entries: 23 tracked modifications/deletion and 40 untracked files. The tracked
deleted placeholder `packages/booking-engine/src/index.test.ts` predates recovery;
substantive domain tests exist in separate files.

Milestone 3 changes center on appointment schema/migration 0002 and metadata,
booking contracts, API route registration, booking domain service, pure availability
and time helpers, booking unit/integration tests, extensions to existing tenant
isolation coverage, and documentation. Existing salon admin/web changes are
Milestone 2 work, not a new appointment UI.
