# Core booking engine — Milestones 3 and 4

The staff API delegates to `apps/api/src/services/booking.ts`; pure scheduling
rules live in `packages/booking-engine/src/availability.ts`. Existing eligibility,
pricing, buffers, notice, limit, and timezone helpers remain authoritative.

## Persistence and historical values

Migration `0002_numerous_grim_reaper.sql` adds `appointments`,
`appointment_services`, `appointment_addons`, `appointment_staff_assignments`,
`appointment_status_history`, and `appointment_idempotency`. Every table carries
`tenant_id`; references to tenant-owned parents include it. Actors reference
installation-wide users. `client_id` is reserved and constrained to null until a
future tenant-safe client model exists.

Snapshots retain ordered service/variant names, integer minor-unit prices,
duration, active/processing split, buffers, add-on names/prices/durations, and
staff name/assignment. Existing occupancy is reconstructed from these snapshots,
never current catalog prices or durations. Constraints enforce positive duration,
nonnegative values, valid splits, ordered timestamps, and cancellation state.

## Availability

Validate tenant-scoped location, staff, service, variant and add-on IDs before
searching. Reuse the eligibility service for each selected service (at most ten),
then intersect eligible staff. Queries are batched across staff and run before
candidate generation; there are no queries per slot. Current loading includes
all booked appointments for the tenant, including other locations, so automatic
break chains and cross-location conflicts cannot be missed. This favors
correctness over large-tenant memory efficiency; there is no availability cache.

Compose each location-local date in this order:

1. Union active weekly work blocks.
2. Subtract recurring breaks.
3. Union dated added availability (which may explicitly reopen a break).
4. Subtract dated removed availability.
5. Subtract scheduled time off applicable to that location or all locations.

Cancelled time off does not block. A candidate's complete occupancy must fit one
continuous resulting interval, so bookings cannot bridge split shifts or breaks.
The central `slotIntervalMinutes` is 15. Generate local grid starts, then apply
notice, horizon, schedule containment, daily limits, automatic breaks, and
appointment conflicts. This evaluates cheap rules before conflicts rather than
materializing every subtraction; the result uses the same complete constraints.
Any-available results sort by UTC start then staff UUID; creation chooses the
first eligible available UUID deterministically. Searches span at most 31 dates.

## Time, buffers, and conflict rules

Recurring schedules retain ISO weekday plus local minutes. Dated overrides retain
local date/minutes; time off and appointments use absolute timestamps. All
conversion and arithmetic reuse the time module. Spring-forward nonexistent
candidate times are skipped; fall-back exposes the first occurrence once, matching
the established conversion policy. Durations are elapsed minutes, even across DST.
The booking horizon includes the final permitted local calendar date; notice is
an elapsed-minute lower bound on the customer start.

Intervals are half-open `[start, end)`: touching endpoints are valid. Price and
duration use variant then technician override; buffers use salon then service
then technician/service. Null inherits; zero is explicit. Services run in input
order with each service's buffers. Add-ons require active time after their service.
The customer start excludes the first before-buffer and the customer end excludes
the final after-buffer; internal buffers remain elapsed time between services.
Capacity includes all buffers. Money remains integer minor units.

Disabled mode rejects all occupancy overlaps. Manual mode still hides overlaps;
an authenticated caller with `manage_calendar` may explicitly override a same-
location appointment conflict, with a required reason and audited actor. It does
not waive schedules, limits, notice, horizon, automatic breaks, or cross-location
conflicts. Online-source creation cannot force an overlap.

Intelligent mode treats a service as active first, then unattended processing.
Only active intervals, buffers, and add-ons require technician capacity. If the
stored split does not match the effective duration, the whole service is active.
Processing overlaps are permitted only at the same location. There is no arbitrary
segment language or multi-technician booking in this milestone.

## Limits and lifecycle

Daily limits include all noncancelled appointments whose customer start falls on
the candidate location's local date, across locations. Booked minutes include
service, processing, and add-ons, excluding buffers. Zero is a real ceiling; null
means unlimited. For locations in different zones, the candidate location defines
the day being checked.

Automatic breaks use the inherited salon/staff rule. Sum service/processing/add-on
workload in the candidate's connected sequence of appointments until an occupancy-
free gap meets the configured break duration. Reject if the sequence exceeds the
threshold, including later appointments joined by insertion. Overlapping bookings
contribute their individual workloads. A single service longer than the threshold
is rejected; unrelated historical violations do not block a new booking. No break
rows are inserted.

Creation revalidates under the transaction lock and writes all snapshots, history,
and idempotency together. Rescheduling keeps staff/location and original snapshots,
checks current eligibility and schedule, excludes its own old occupancy, and changes
times plus history atomically. A failed move preserves the original booking.
Cancellation records status, timestamp, actor, and optional reason, preserves all
snapshots, and releases capacity. Repeated cancellation does not duplicate history.
See [concurrency](concurrency.md) for the protected boundary.

## Staff APIs

All paths begin `/api/v1/tenants/:tenantId`; existing session, CSRF, tenant guards,
`manage_calendar`, Zod validation, error handling, and OpenAPI conventions apply.

- `POST /availability/search`
- `GET /appointments` (limit/offset; location, staff, status, and start filters)
- `POST /appointments` (body includes `idempotencyKey`)
- `GET /appointments/:appointmentId`
- `POST /appointments/:appointmentId/reschedule`
- `POST /appointments/:appointmentId/cancel`

Resource substitution returns 404. Expected booking failures return named safe
409 errors without another client's details. Milestone 4 adds a separately scoped
[public booking adapter](public-booking.md) that shares this create/search pipeline.
Guest contact and token snapshots commit in the same transaction; staff appointment
detail includes the contact. Payments, CRM and prerequisite enforcement remain out
of scope.
