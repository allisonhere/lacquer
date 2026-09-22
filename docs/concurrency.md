# Booking concurrency and idempotency

Every create, reschedule, and cancel runs in one PostgreSQL transaction. Before
reading booking state it acquires a transaction-scoped advisory lock:

```sql
select pg_advisory_xact_lock(hashtextextended('lacquer:booking:' || tenant_id, 0));
```

The lock serializes booking mutations for a tenant across API instances and
locations, including any-available selection and daily limits. The default
READ COMMITTED isolation gives reads after a wait the preceding transaction's
committed result. Staff membership and calendar permission are refreshed after locking. Guest
creation refreshes active public tenant opt-in instead, and verifies that the slug
still resolves to the tenant whose lock was acquired.
Validation, capacity claim, snapshots, history, and idempotency all precede commit.
Rollback releases the lock and leaves no partial appointment. Hash collisions
only serialize unrelated tenants; they cannot allow an invalid booking.

This is deliberately a coarse lock. Future throughput work must preserve ordered
locking across staff/locations, daily limits, automatic-break chains, and
idempotency. Availability is a read-only observation and can become stale;
creation always revalidates under the lock. Every future booking writer must use
this service/locking protocol: advisory locks do not constrain arbitrary direct
SQL. Catalog/schedule administration does not use this booking lock and can change
configuration independently; it does not retroactively rewrite appointments.

The concurrency integration test holds the production lock, launches two real
HTTP creates, observes both waiting PostgreSQL advisory locks through `pg_locks`,
then releases the holder. Exactly one returns 201, one returns safe 409
`SLOT_UNAVAILABLE`, and exactly one appointment exists. Nothing is mocked.
Concurrent distinct-slot creation also checks the daily appointment cap.

Idempotency uses `(tenant_id, key)` as a primary key and a SHA-256 hash of the
validated normalized request. Defaults and UTC instants are normalized; add-on
IDs are sorted because their order is immaterial; service order is preserved.
Under the same lock, matching retries return the same appointment ID and its
current detail. A different payload produces `IDEMPOTENCY_CONFLICT`. The key and
booking commit together, so failed creates reserve no key. Keys do not expire.
Retries after cancellation/rescheduling return the existing appointment's current
state rather than replaying an obsolete response. Concurrent identical retries
are covered by a real integration test.

Milestone 4 guest creation uses this same operation and lock, with `online` source,
a pinned technician, and no manual override. Contact and hashed-token records
commit alongside the appointment. Public keys are namespaced `public:<uuid>`;
normalized guest contact fields participate in the request hash. See
[public booking](public-booking.md) for token derivation and retry behavior.
