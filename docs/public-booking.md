# Public customer booking — Milestone 4

## Flow and routes

`/book/:tenantSlug` is a guest, service-first flow: location (skipped for one
active location), service/variant/add-ons, technician, date/time, contact details,
and review. Submission is an explicit review action. `/book/manage/:token` shows
confirmation and the saved appointment without a customer account. Customer
cancellation/rescheduling require contacting the salon; no unfinished policy or
payment controls are exposed.

Enable online booking in the salon overview (`manage_business`) or with the
existing tenant PATCH API. The new `publicBookingEnabled` setting defaults false;
the `lacquer-demo` seed opts in. Salon name and Lacquer's ivory/plum typography
provide branding. No logo or service-image storage exists in the current schema.

The step list and draft model live in `apps/web/src/lib/public-booking.ts`; the
view is `BookingFlow.svelte`. Upstream changes clear the slot and submission key;
service/location changes also clear dependent variants/add-ons/technician choices.
The draft is tab-scoped session storage, including contact details, and is removed
on success. URL query steps support Back/Forward; refresh restores the draft and
validates selections. No navigation event creates an appointment. There is no
technician-first flow or forms step yet, but both can extend the step model.

## Public API boundary

All endpoints are under `/api/v1/public` and documented as **Public booking** in
OpenAPI. Guest mutations retain the existing Origin and `X-Lacquer-Request: 1`
checks; they require no session. Staff/admin routes retain their permissions.

| Method/path                              | Purpose                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| `GET /:tenantSlug`                       | Active, opted-in salon, currency, safe locations and horizon  |
| `GET /:tenantSlug/services?locationId=…` | Online catalog, categories, variants and valid add-ons        |
| `POST /:tenantSlug/staff`                | Eligible online technicians and effective displayed totals    |
| `POST /:tenantSlug/availability/search`  | Authoritative candidate slots                                 |
| `POST /:tenantSlug/bookings`             | Guest creation; selected staff, contact, UUID idempotency key |
| `GET /bookings/:token`                   | Token-authorized appointment view                             |

Explicit Zod DTOs omit tenant IDs, audit history, permissions, internal descriptions,
private staff fields, buffers and capacity reasoning. Staff display names and
resource UUIDs required for selection are public. Hidden price/duration values
are null throughout catalog, staff, slot and booking responses; slots omit end
times. Exact/starting-at modes are rendered using installation currency and the
existing money formatter. Final review uses a fresh server slot, including its
technician-specific total. Public booking currently selects one service with
optional variant and add-ons, assigned to one technician at one location.

Tenant resolution requires both active status and opt-in. Foreign location,
service, variant, add-on and staff substitution returns 404. Public creation is
not implemented in the route: `createGuestAppointment` shares Milestone 3's
create operation, tenant advisory lock, eligibility, pricing, snapshots and
idempotency transaction. The guest scope is a separately branded internal context,
never a fabricated owner membership. It forces `online` source and forbids manual
overrides; the lock refreshes the public tenant resolution before validation.

## Availability, review and retries

The browser does not calculate eligibility, capacity or slots. It calls the
existing engine through the public adapter. This UI requests one local day at a
time; API range requests remain capped at 31 local dates. The existing horizon
limits the date picker. Dates and times use the selected location's IANA timezone
and existing time helpers. Milestone 3's DST and interval policies remain unchanged.

Any Available displays the engine's deterministic staff/start ordering. Selecting
a slot pins its actual staff ID; review and create never silently reassign it.
Changing a variant/add-on/technician invalidates the prior slot. Required add-ons
are selected, and exclusive choices are enforced by both UI and booking service.

The submission UUID is retained in the tab draft for double clicks, failed network
responses and refresh retries; material payload edits invalidate it. The server
namespaces it as `public:<uuid>` and includes normalized contact data in the
existing request hash. Matching retries return the same appointment and token.
A slot conflict returns safe 409, preserves contact/selection data, refreshes times,
and returns the customer to time selection. Contact/token rows are inserted in the
same transaction, so failed claims cannot leave orphan guest data.

## Guest history and token security

Migration `0003_nifty_hellcat.sql` adds `appointment_contacts`,
`appointment_public_access`, and the tenant opt-in boolean. Both child tables use
composite tenant/appointment FKs. The contact snapshot holds names, email, phone,
and a separate `customer_note`; it does not overwrite staff appointment notes.
Authorized staff appointment detail includes the contact. The reserved client ID
stays null. A future CRM may link the appointment to a client while preserving
this original guest snapshot.

Management tokens are 256-bit HMAC-SHA-256 outputs encoded as 43-character
base64url strings, domain-separated with the server `SESSION_SECRET` and the
appointment UUID. The UUID alone grants no access. Only a SHA-256 token digest is
stored; deterministic derivation allows a lost create response to be retried
without storing the raw token. Price/duration display modes are snapshotted with
the access record, alongside the existing transactional booking snapshots.

Lookup hashes the token and matches its own appointment; malformed/unknown tokens
return generic 404. Links remain viewable after disabling new public bookings,
but suspended tenants are unavailable. Tokens have no expiry, self-service
revocation or rotation UI yet. Anyone holding a link can view its contact details.
Keep links private. Existing links still match stored hashes after secret rotation;
reconstructing a token on a create retry requires the original secret. A future
rotation strategy must account for that rather than silently changing keys.

API logs redact token path segments and never log request contact bodies. Public
pages use `no-store`, `no-referrer` and `noindex`. Public API responses use no-store
and no-referrer. No email/phone is put in a URL. Do not add analytics to secure
booking pages that capture their URL or contents.

## Rate limiting and delivery extension

Limits per visitor per route/minute: catalog/salon/staff 120, search 60, create 10,
lookup 30. Redis remains the backing store. SvelteKit signs its observed client
address in server-only headers using the shared secret; the API verifies the
signature before using that visitor's rate bucket. Unsigned/spoofed requests fall
back to the API socket address. Admin rate limiting is unchanged. The Compose web
service now receives the same server-only secret. Deployments behind another
proxy must configure SvelteKit's trusted client-address handling correctly; never
trust arbitrary user-supplied forwarding headers.

No production email transport exists. The optional post-commit
`PublicBookingCreatedEvent` callback exposes customer-safe booking details and the
management URL for a future delivery adapter. It is not a durable notification
queue, may be invoked on idempotent retries, and consumers must deduplicate. Its
failure does not undo a committed booking. No email or SMS is sent in this milestone;
the confirmation page says so and offers the secure link to save.

## Milestone 5 must preserve

Use the same authoritative booking service and transaction/locking protocol for
payment-aware creation. Preserve tenant-safe FKs/404s, snapshots, integer money,
null/zero inheritance, guest-contact privacy, public DTO masking, pinned technician
selection, idempotency and secure links. Payment callbacks must not become a second
appointment writer. Define payment/reservation states and policies before extending
them; this milestone does not add deposits, refunds, CRM, forms or a staff calendar.
