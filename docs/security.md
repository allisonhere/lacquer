# Security

## Tenant-isolation invariant

**A protected operation may access a tenant-owned record only when the authenticated user has a current membership in that active tenant, and the record's tenantId equals the validated tenant context. Writes additionally require the relevant effective permission.**

A tenant ID supplied by the client is a selector, never an authorization claim. `resolveTenantContext` validates UUID syntax, queries membership joined with active tenant status, and returns a branded context. Route guards authenticate first. Services accept the validated context and permission checks remain server-side. Non-members receive 404 to avoid disclosing tenant existence. Invalid UUIDs produce a safe 400. Lists only return memberships belonging to the current user.

`createLocationService` uses tenantScope for every read/update. Creation sets tenantId from validated context; strict input schemas reject tenantId, id, roles, and arbitrary unexpected fields. Resource substitution under an otherwise valid tenant is still denied. Tests verify both tenant-path substitution and foreign location IDs under the attacker's own tenant, and verify denied writes did not change the target data.

Future route authors must use this pattern for every tenant-owned table. Use a tenant FK and composite tenant/resource FKs when a tenant-owned row refers to another tenant-owned row. Do not treat frontend filtering or the switcher as security. The branded type prevents ordinary accidental context construction; it is not a sandbox against malicious backend code. PostgreSQL RLS is not enabled in this milestone; application-layer scoping and tests are mandatory.

Membership checks occur on every request, so revocations/toggles affect subsequent requests. An already in-flight authorized request may finish during an administrative change; future membership-management workflows should define transaction/locking semantics if stronger serialization is needed. There are no membership mutation endpoints in this milestone.

## Authentication

Passwords use Argon2id with 19 MiB memory, two iterations and parallelism one; salts are library-generated. Registration requires 12–128 characters. Password hashes are never included in public user responses. Unknown email/password attempts use generic errors and a dummy Argon2 verification path. Registration currently returns conflict for an existing email, so account existence is not concealed at that endpoint.

Sessions use 32 random bytes from Node's cryptographic RNG. PostgreSQL stores HMAC-SHA256 digests keyed by SESSION_SECRET, not raw tokens. The random bearer token is sent only as an HttpOnly, SameSite=Lax cookie with a seven-day maximum lifetime. Production requires HTTPS and uses Secure plus the __Host- prefix with Path=/ and no Domain. Logout deletes the session; logout-all and password reset delete all user sessions. Logging in rotates the current browser session. Rotating SESSION_SECRET invalidates all outstanding sessions and action links.

Auth-token foundation supports magic_link, email_verification, and password_reset. Tokens expire after 15 minutes and are atomically deleted on consumption in a transaction. Wrong-purpose, expired, and replayed links fail. Magic-link use verifies email and creates a session. Password reset changes the hash and revokes sessions and outstanding user links atomically. The internal issuer returns raw tokens once to a future email adapter; do not log or expose this service publicly.

**Email delivery and public magic-link/reset/verification endpoints are intentionally deferred.** Password registration/login works today; email verification is not yet required to create a salon. Unverified public account creation needs product/deployment policy before an Internet-facing hosted launch. Email changes are not exposed; future email-change flows must bind verification to the intended address and invalidate outstanding links.

## CSRF and transport

All mutations, including auth entry points, require an exact Origin match with APP_URL and X-Lacquer-Request: 1. Cross-origin requests cannot attach this custom header without a preflight; the API grants no CORS access. Cookies use SameSite=Lax as additional protection. GET endpoints perform no mutation. Non-browser clients must send the same origin/header contract. Use a single public origin and no application subpath.

The SvelteKit server proxy forwards only a fixed set of request/response headers to its configured API origin. It never trusts client-supplied forwarded IP headers. API trustProxy is off. As a conservative initial policy, requests through the web proxy share its upstream IP rate-limit bucket; before SaaS scale, configure a trusted edge and an explicit verified client-IP policy rather than blindly trusting X-Forwarded-For. Limit request bodies at the external edge as well as Fastify.

## Roles and abuse controls

Roles are owner, manager, front_desk, and technician, centralized in packages/types. Owner retains every permission. Per-membership allow/deny rows override defaults for other roles. No public role/permission mutation endpoints exist. API uses Redis-backed global rate limiting and lower auth limits, fails closed on limiter errors, and rejects unknown input fields. Future deployments should tune thresholds and add distributed abuse controls appropriate to their traffic.

## Logs, errors, and operations

API logs are structured with service name, request ID, method, sanitized URL, status and duration. Request bodies, query strings, cookies, authorization headers, passwords and tokens are not logged. Internal response errors are generic; log stacks omit potentially sensitive first-line database/validation messages. Do not log configuration objects. Provider credentials remain server-only.

Database queries are parameterized by Drizzle. Unique email/slugs, membership pair constraints, purpose/role/permission enums, foreign keys, and expiry constraints provide database-level integrity. All table relationships are explicit; soft deletes are not a default policy. Expired tokens/sessions are denied immediately but retained until operational cleanup; a scheduled cleanup job is deferred.

Compose is local-only, binds exposed ports to loopback, and has publicly documented fake passwords. A production operator must supply secrets, HTTPS, database/Redis access controls, backups, upgrade procedures, and a separate migration role as appropriate. The application image runs as a non-root user and handles SIGTERM/SIGINT. Do not expose Redis or Postgres to the Internet. Keep OpenAPI exposure consistent with deployment policy; it contains contracts, not business data.

## Reporting

Do not include real credentials, session tokens or tenant data in public issues. Until a private security reporting channel is established, coordinate a private report with repository maintainers before disclosing an exploitable issue publicly.

## Dependency review

The root pnpm override pins Swagger UI's static-file dependency to @fastify/static 10.1.2, which declares Fastify 5 compatibility. This addresses [GHSA-83w8-p2f5-377r](https://github.com/fastify/fastify-static/security/advisories/GHSA-83w8-p2f5-377r) and [GHSA-8pvw-jcv7-9cmj](https://github.com/fastify/fastify-static/security/advisories/GHSA-8pvw-jcv7-9cmj). Keep the override until the compatible Swagger UI dependency range includes the fix; run `pnpm audit --prod` and integration/OpenAPI tests when changing it.
