# Milestone 4 handoff — Public customer booking

Completed and verified on 2026-09-08. Milestone 5 has not started. No commit was
made; all recovered Milestone 2/3 work remains in the working tree.

## Implemented experience

Customers can open `/book/:tenantSlug` without an account, choose a location,
service, variant and valid add-ons, choose a technician or Any Available, select an
actual available time, enter contact details and an optional note, review, and
explicitly confirm. Confirmation and later viewing use `/book/manage/:token`.
The browser never calculates eligibility, slots or conflicts. Final creation uses
the existing authoritative booking service and PostgreSQL tenant advisory lock.

The location step is skipped for one active location. Categories filter the
catalog; inactive, invisible and offline services are excluded. Active variants
change technician eligibility and effective values. Required add-ons are selected;
exclusive groups prevent incompatible choices. Upstream changes invalidate slots,
technician choices as appropriate, and the submission key. Back/Forward and tab
refresh preserve the draft; reaching review never books automatically.

The customer-facing design uses warm ivory, plum accents, serif headings,
spacious service rows and a sticky mobile continuation action. Branding uses the
salon's name; the current schema has no logo or service-image storage. Desktop
adds a quiet visit summary; mobile remains a single column. Inputs have labels,
validation messages, focus styles and autocomplete. Slots are native buttons
with keyboard operation and `aria-pressed`; the mobile journey tests Enter
selection and absence of horizontal overflow at 390 pixels.

## Resume and preview

```sh
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Use the existing `.env`; do not replace it. The seed enables public booking for
**Lacquer Demo Salon**. Open <http://localhost:5173/book/lacquer-demo> for the guest
flow. Staff sign-in is <http://localhost:5173/login> with the fake development
credentials `owner@example.test` / `Development-only-123!`. Other salons opt in
through **Customer booking** in the overview; `manage_business` is required.

Migrations and seed were applied successfully to the local development database.
The browser tests also created real demo appointments, which remain in that
salon's development calendar and consume availability. Integration fixtures are
uniquely named and cleaned up. PostgreSQL/Redis were already running; dev servers
started in the previous session may need restarting after a session/reboot. The
browser test servers on 3101/5273 stop when Playwright finishes.

## Public API and authorization

Endpoints are under `/api/v1/public`, with separate OpenAPI **Public booking**
tags and explicit customer-safe response schemas:

| Endpoint                                 | Behavior                                                           |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `GET /:tenantSlug`                       | Salon name/slug/currency, active locations, local date and horizon |
| `GET /:tenantSlug/services?locationId=…` | Categories, public descriptions, display modes, variants/add-ons   |
| `POST /:tenantSlug/staff`                | Existing online eligibility and effective displayed totals         |
| `POST /:tenantSlug/availability/search`  | Existing availability engine, masked public slots                  |
| `POST /:tenantSlug/bookings`             | Pinned staff and guest contact; idempotent transactional creation  |
| `GET /bookings/:token`                   | View only the appointment authorized by the token                  |

Public tenant resolution requires active status and explicit opt-in, which defaults
to false. Public code uses a separately branded context, not a fake staff identity.
After acquiring the existing tenant lock, creation refreshes opt-in and checks
that slug resolution still refers to the locked tenant. Staff/admin guards remain
intact. Public payloads cannot specify tenant ID, source, actor or manual override;
the service forces online source and a specific reviewed technician.

DTOs omit tenant IDs, permission and audit fields, staff contact/bio information,
internal service descriptions, buffers and availability reasoning. Customer-facing
resource UUIDs remain selectable. Cross-tenant location/service/variant/add-on/staff
substitution returns 404. Hidden price/duration values are null throughout public
DTOs; slot responses do not expose end times. All money is integer minor units and
uses the installation currency and existing formatter.

## Persistence, privacy and links

Migration `0003_nifty_hellcat.sql` adds only:

- `tenants.public_booking_enabled`, default false.
- `appointment_contacts`: tenant/appointment key, historical first/last name,
  normalized email, phone, separate customer note and creation timestamp.
- `appointment_public_access`: tenant/appointment key, token digest, historical
  price/duration display modes and creation timestamp.

Both child tables reference appointments through composite tenant-aware FKs.
Guest contacts and access records commit in the same transaction as appointment,
service/add-on/staff snapshots, history and idempotency. Failed claims leave no
orphan contacts. Authorized staff appointment detail now includes the contact.
The reserved appointment client ID remains null. Future CRM linkage must preserve
this original booking contact snapshot rather than replace it with mutable client
data. Customer notes remain distinct from staff appointment notes.

Management tokens are 256-bit domain-separated HMAC-SHA-256 values, using the
server `SESSION_SECRET` and appointment UUID, encoded as 43-character base64url.
Only a SHA-256 digest is persisted. The appointment UUID is not a secret and
cannot retrieve a booking. Deterministic token derivation permits idempotent
response recovery without raw token persistence. Tokens authorize only their own
appointment; invalid links return generic 404. Disabling new bookings does not
invalidate existing links; suspended tenants cannot be viewed.

Token path segments are redacted from API request logs. Contact bodies are not
logged. Public pages use no-store/no-referrer/noindex and public APIs use no-store
and no-referrer. Contact details never appear in URLs. A link is a bearer
credential; the confirmation asks customers to save it privately. Session storage
holds the in-progress contact draft per tab and clears it on success.

## Availability, review and lifecycle

Public searches use the Milestone 3 pipeline with online eligibility gates. The UI
requests one local day at a time within the salon horizon; API ranges remain
bounded to 31 dates. Time display uses the selected location's IANA timezone with
existing time utilities. No frontend UTC arithmetic or second availability engine
was introduced. Milestone 3's first-occurrence fall-back policy remains unchanged.

Any Available preserves deterministic engine ordering. Selecting a slot pins its
actual technician. Before review, the exact slot and current displayed totals are
refreshed; creation revalidates under the lock. The reviewed technician is never
silently changed. Conflicts preserve contact and service choices, refresh available
times, and return the customer to time selection with friendly wording.

A UUID idempotency key is retained for one submission payload across double clicks,
network retries and refreshes. Material edits invalidate it. The backend namespaces
public keys and includes normalized guest contact in the request hash. Matching
retries return the same appointment and token; incompatible reuse conflicts.

Confirmation shows booked/cancelled state, salon/location, snapshot service,
variant/add-ons, technician, local time, visible totals, contact and booking
reference. Secure lookup works in a fresh browser without the original session.
Self-service cancellation/rescheduling policies are deferred; the UI explains how
to contact the salon instead. Staff lifecycle APIs continue working unchanged.

## Abuse protection and confirmation delivery

Public Redis-backed limits per visitor/route/minute are 120 for salon/catalog/staff,
60 for search, 10 for creation, and 30 for token lookup. SvelteKit signs its observed
client address in server-only headers; the public API verifies that signature
before assigning the visitor bucket. Spoofed/unsigned headers fall back to socket
IP. Admin behavior is unchanged. Compose web now receives the same server-only
secret. Reverse-proxy deployments must configure trusted client-address handling
at SvelteKit correctly; do not trust arbitrary forwarding headers.

There is no production email provider implementation. An optional post-commit
`PublicBookingCreatedEvent` hook carries the safe booking view and management URL
for future confirmation delivery. It is not a durable outbox and may receive
idempotent retries, so delivery consumers must deduplicate. Delivery errors cannot
roll back a booking. No email or SMS is sent, and the confirmation page says so.

## Verification actually run

Before edits, all 96 unit tests, 51 integration tests, typecheck and build passed.
After implementation:

| Command                                                                                         | Result                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                     | Passed                                                                                                     |
| `pnpm typecheck`                                                                                | Passed                                                                                                     |
| `pnpm test`                                                                                     | 100 passed in 11 files                                                                                     |
| `pnpm test:integration`                                                                         | 60 passed: 14 foundation, 20 salon operations, 18 booking, 8 public booking                                |
| `pnpm build`                                                                                    | Passed, including production web build                                                                     |
| `pnpm test:integration apps/api/src/booking.integration.test.ts -t mandatory`                   | Concurrency and idempotency passed                                                                         |
| `E2E_API_PORT=3101 E2E_WEB_PORT=5273 pnpm test:e2e tests/e2e/public-booking.spec.ts`            | Public mobile guest journey passed                                                                         |
| `E2E_API_PORT=3101 E2E_WEB_PORT=5273 pnpm test:e2e`                                             | All three browser journeys passed, including existing admin flows                                          |
| `pnpm exec dotenv -e .env -- pnpm --filter @lacquer/db exec tsx src/verify-clean-migrations.ts` | All four migrations passed in a fresh disposable test database; both new tables verified; database removed |
| `pnpm db:generate`                                                                              | Generated focused migration 0003; FK ordering inspected                                                    |
| `pnpm db:migrate` / `pnpm db:seed`                                                              | Passed for development preview                                                                             |
| `docker compose config --quiet`                                                                 | Passed                                                                                                     |
| `git diff --check`                                                                              | Passed                                                                                                     |

Focused timezone command:

```sh
pnpm exec vitest run packages/booking-engine/src/time.test.ts packages/booking-engine/src/availability.test.ts -t 'DST|spring|fall|local'
```

Result: 12 passed, 33 unrelated cases skipped. The full unit suite also ran.
Changed sources were formatted with targeted `pnpm exec prettier --write`.

New integration coverage includes public tenant opt-in/suspension, hidden locations,
online catalog and field privacy, eligible online staff, hidden display modes,
search, booking/contact/snapshots, hashed token and secure lookup, concurrent
idempotent retries, incompatible contact reuse, public slot races with no orphan
rows and a fresh-slot retry, required/exclusive add-ons, privilege injection,
rate limiting, OpenAPI and all five resource-substitution cases. The existing
isolation suite also tests public selections and guest-table composite FKs.

New unit tests cover draft invalidation/contact preservation, public request bounds,
tenant PATCH default semantics, and signed rate-limit identity. The public browser
journey uses real seeded variants/add-ons and availability, keyboard slot selection,
contact/review/confirmation, Back/Forward/refresh, a fresh-browser secure lookup,
privacy headers and narrow viewport overflow. Mobile review/confirmation screenshots
were generated under ignored `test-results/` and visually inspected.

Milestone 3 tests were not rewritten. Concurrency still proves two PostgreSQL
waiters before releasing the production lock, then exactly one successful booking,
one safe 409 and one appointment. Idempotency, tenant isolation, DST, buffers,
split shifts, automatic breaks, daily limits, overlap modes, rescheduling and
cancellation remain passing.

## Failures found and fixed

- A strict inherited location schema rejected public DTO projection, including
  post-create lookup. Changed the public projection to strip internal fields;
  verified creation and retry responses through real tests.
- An incomplete contact-read query was caught by typecheck and corrected before
  rerunning staff/public API regressions.
- Defaulted opt-in inside a partial tenant schema could reset the setting during
  unrelated edits. Removed the input default (the database retains it) and added
  a regression test.
- Proxying could combine visitors into one public rate bucket. Added signed,
  verified visitor identity with spoofing tests instead of changing admin trust.
- Restored add-on choices could become stale after catalog changes. Restore now
  reapplies required choices and clears incompatible slot/submission state.
- Slug reassignment during lock acquisition could change the resolved tenant.
  Added an explicit locked-tenant identity check.
- Navigation lint flagged correctly resolved paths with appended query strings;
  added narrowly explained lint exceptions. Fixed a self-closing textarea warning.
- Clean-migration verification initially hit sandbox IPC restrictions; the same
  command succeeded outside the sandbox.
- Superdesign preflight required network access, then login failed with ECONNRESET.
  No remote draft was produced. After the user's instruction to continue, the UI
  was implemented locally using the repository's visual language.

## Limits and rules for Milestone 5

No payments, deposits, prepayment, card storage, refunds, cancellation fees, CRM,
photos, forms, waitlist, SMS, calendar integration or staff calendar were built.
Public selection is one service/variant with add-ons, one technician and one
location. Service-first is supported; technician-first remains an extension.
Guest clients remain null and prerequisites are not enforced through client history.
The tenant-wide lock, tenant-wide booked-appointment batch loading, local-date daily
accounting and automatic workload semantics are unchanged.

Links have no expiry, revocation UI or key-versioning yet. Existing raw links
continue to match stored hashes after secret rotation, but deterministic recovery
of an old submission token requires its original secret. Plan key rotation before
changing secrets for existing idempotent retries. Confirmation delivery is a hook,
not a durable notification system. A read-only slot/review is not a reservation,
and configuration may change before final commit; there is no payment price-lock
policy in this milestone. Frontend draft storage is per tab, not cross-device.

Milestone 5 must preserve composite tenant FKs and 404 substitution, integer money,
null/zero inheritance, existing eligibility/price/time helpers, historical snapshots,
half-open buffered occupancy, cancellation capacity release, atomic rescheduling,
all booking writers using the same lock/service, pinned reviewed technicians,
public privacy/masking, guest snapshots, secure links and idempotency. Payment
webhooks must never bypass the booking transaction or directly insert appointments.
Define reservation/payment transitions explicitly while keeping the existing
race, isolation, browser and DST regression tests.

## Git / changed-file summary

Final status contains 84 file entries: 25 tracked changes/deletion and 59 untracked
files, including the recovered work. No commit, reset, clean or discard was
performed. The tree contains the recovered
Milestone 2/3 changes plus this milestone. New Milestone 4 files cover public
context/rate-limit helpers, public API service/routes/tests, frontend draft logic,
booking flow/style and routes, public Playwright journey, request-schema tests,
clean-migration verification, migration 0003/metadata and this documentation.
Existing shared booking code, schema contracts, tenant model/seed, root web layout,
web proxy, salon overview, Compose secret wiring, isolation coverage and README/docs
were extended. The deleted old booking-engine placeholder test predates this work.
