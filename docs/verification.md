# Milestone 1 verification

Verified on 2026-09-07. Final static/runtime/browser checks used Node 22.23.2 and pnpm 10.30.3. Earlier iterations used the host Node 26.7.0. Because the host denied Docker socket access, real temporary PostgreSQL 18.4 and Redis 7.4.2 services were used. Compose/CI target PostgreSQL 17 and Redis 7; their container execution is not verified here.

## Successful commands and checks

- `pnpm install` and `pnpm install --frozen-lockfile --offline`: succeeded. pnpm was initially unavailable; it was downloaded with npm and made available through a temporary PATH entry.
- `pnpm db:generate`: generated the initial seven-table migration and Drizzle metadata.
- `pnpm db:migrate`: applied migrations to the development database. Integration tests separately applied them to the dedicated test database.
- `pnpm db:seed`: created the fake owner/technician, two salons and two locations.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm typecheck`: passed, including root test/config files and Svelte diagnostics.
- `pnpm test`: 13 passed; one intentional booking-engine todo placeholder.
- `pnpm test:integration`: 14 passed against real PostgreSQL/Redis, including cross-tenant read/write denial, role overrides, revoked memberships, suspended tenants, single-use auth tokens, session revocation, throttling, and dependency-outage readiness.
- `pnpm build`: passed.
- `pnpm exec playwright install chromium`: succeeded; Playwright used its Ubuntu fallback browser build on this host.
- `pnpm test:e2e`: final run passed (one Chromium flow). Covers app load, registration, two salons, location creation, switching tenants, logout, login, dashboard and mobile overflow check. Desktop/mobile screenshots are in the ignored test-results directory.
- `pnpm job:demo`: queued successfully; worker logs confirmed completion.
- `python /tmp/lacquer-runtime-check.py`: temporary verification harness started API/worker under Node 22 on isolated ports, checked health/readiness, processed demo jobs, sent SIGTERM and SIGINT, and confirmed exit code 0 for all four process runs.
- `pnpm audit --prod`: final run reported no known vulnerabilities after the documented Fastify static dependency override.
- `docker compose config --quiet`: passed.

## Failed attempts and corrections

Initial typecheck found date transport mismatches, a missing web Zod dependency and a logger typing issue; corrected. Initial lint found Svelte navigation resolution issues; corrected. Browser runs exposed accessible-label hint text and an empty-body JSON header on logout; both corrected and the final smoke run passed. The first production dependency audit found two Fastify static advisories; the patched compatible dependency passed audit and OpenAPI integration tests.

Sandboxed network/socket operations failed during setup and migration execution; authorized runs outside the sandbox succeeded. An initial temporary PostgreSQL initialization retry found an already-initialized directory; startup reused that directory. Initial browser installation in the sandbox could not finish; the authorized installation succeeded.

## Unverified / remaining limitations

`docker info` and `docker compose build` failed with permission denied for `/var/run/docker.sock`, including outside the sandbox. Therefore `docker compose up --build`, image construction, container DNS, and a complete clean-checkout Docker startup were not demonstrated. Compose configuration passed static validation and was reviewed for service hostnames, dependency ordering, migrations and health checks. The GitHub Actions workflow is present but was not run remotely.

The milestone cannot be claimed fully complete against every requested completion criterion until Docker startup is verified on a Docker-enabled host. Backend, web, worker and browser behavior were verified through the native setup.

Email delivery/public magic-link, verification and password-reset endpoints remain deferred; their internal token services are implemented and tested. Membership/toggle administration is not exposed. Expired session/token cleanup is deferred. API/worker runtime images retain TypeScript tooling. All later booking/payment/CRM features remain absent.
