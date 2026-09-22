# Lacquer

Open-source, multi-tenant salon software. Nail salons first, with a foundation that can support other beauty businesses later. Self-hostable and suitable for a future Lacquer Cloud service.

**Milestone 4: public customer booking.** Account authentication, business memberships, fixed permissions, and locations (Milestone 1), plus staff profiles, service catalog, variants, add-ons, skills, technician eligibility, per-technician pricing overrides, weekly schedules with split shifts, breaks, time off, dated availability exceptions, and salon scheduling defaults. Milestone 3 adds staff appointment APIs, availability search, historical snapshots, concurrency-safe creation, idempotency, rescheduling, and cancellation. Milestone 4 adds a mobile guest booking flow, safe public catalog and availability APIs, guest contact snapshots, confirmation, and private booking links. Payments, CRM, calendar UI, loyalty, waitlists, gift cards, and provider integrations remain out of scope.

Licensed under **AGPL-3.0-only**; see [LICENSE](LICENSE). Modified versions offered over a network must meet the license's corresponding-source obligations.

## Quick start with Docker

Requires Docker Engine with Compose v2+ and available localhost ports 5432, 6379, 3001, and 5173. No host Node.js, PostgreSQL, or Redis is needed for this path.

```sh
docker compose up --build
```

Compose starts PostgreSQL and Redis, applies checked-in Drizzle migrations through a one-shot `migrate` service, then starts API, web, and worker. Open **http://localhost:5173**. Register an account, create a salon, and add a location. Create a second salon to try the tenant switcher.

Optional fake development data, from another terminal:

```sh
docker compose exec api pnpm --filter @lacquer/db seed
docker compose exec worker pnpm --filter @lacquer/worker demo
docker compose ps
docker compose logs worker
```

The seed is repeatable. It creates two small example salons plus **Lacquer Demo Salon** — two locations (Downtown, North), two technicians (Alex Morgan, Jamie Lee), four categories, four services with variants and add-ons, skills, weekly schedules including a split shift and recurring breaks, one time-off record, dated availability exceptions, and a per-technician pricing override. All data is fictional. It does not overwrite existing passwords.

| Development account  | Password                |
| -------------------- | ----------------------- |
| `owner@example.test` | `Development-only-123!` |
| `staff@example.test` | `Development-only-123!` |

These credentials are public and fake. The seed refuses to run with `NODE_ENV=production`.

Compose is a **local development configuration** with public example passwords, loopback port bindings, and HTTP cookies. For deployment, supply real credentials, set `NODE_ENV=production`, configure HTTPS and matching APP_URL/ORIGIN, and put the app behind a controlled reverse proxy. See [security](docs/security.md).

```sh
docker compose down # preserves database and Redis volumes
```

## Native development

Prerequisites: Node.js 22 LTS (the Docker/CI baseline), pnpm 10.30.3, and Docker Compose for dependencies. Install pnpm through Corepack or your package manager. Do not run the full Compose application and native servers on the same ports simultaneously.

```sh
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [the sign-in page](http://localhost:5173/login) and use the demo credentials above. `pnpm dev` loads the root `.env` and runs web, API, and worker with reloads. All services are started explicitly; no hidden host services are required.

For the customer experience, open [the demo salon booking page](http://localhost:5173/book/lacquer-demo). No customer account is required. Other salons can enable online booking from the salon overview. See [public booking](docs/public-booking.md) and the [Milestone 4 handoff](docs/handoff-milestone-4.md).

## Workspace

```text
apps/
  api/                 Fastify REST API, guards, services, integration tests
  web/                 SvelteKit app and same-origin API proxy
  worker/              BullMQ worker, demo job, health server
packages/
  db/                  Drizzle schema, migrations, client, seed, scoping helper
  schemas/             Shared Zod request/response and environment contracts
  types/               Roles, permissions, common domain types
  ui/                  Shared Svelte button and notice
  booking-engine/      Pure domain rules: money, timezones, effective values, eligibility
  integrations/        Reserved provider adapters; no integrations implemented
docker/                Shared application Dockerfile and test database init
scripts/               Development helper space
tests/e2e/             Playwright smoke flow
docs/                  Architecture, development, security, verification
.github/workflows/     CI
```

Internal packages export TypeScript source. API and worker use `tsx` in development and the foundation runtime image; SvelteKit compiles its production output with adapter-node. `pnpm build` typechecks backend/shared packages and builds the web artifact. This explicit arrangement avoids broken workspace output paths; a later packaging optimization can emit backend JS without changing package boundaries.

## Configuration

[.env.example](.env.example) lists required, defaulted, optional, and reserved settings. Native root commands load `.env`; Compose supplies container-specific hostnames explicitly and optionally reads APP_URL, SESSION_SECRET, INSTALLATION_CURRENCY, and LOG_LEVEL from the shell/root `.env`.

| Setting                                            | Purpose                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `REDIS_URL`                        | Required API/worker dependencies; migrations need only DATABASE_URL                       |
| `APP_URL`                                          | Public origin used for CSRF checks; no subpath                                            |
| `SESSION_SECRET`                                   | Required 32+ character secret for token HMAC; generate a random value for production      |
| `INSTALLATION_CURRENCY`                            | Installation-wide ISO currency, USD by default                                            |
| `API_INTERNAL_URL`                                 | Server-only API upstream used by web, `http://api:3001` in Compose                        |
| `ORIGIN`, `HOST`, `PORT`                           | SvelteKit adapter-node deployment values                                                  |
| `NODE_ENV`, `LOG_LEVEL`, `API_PORT`, `WORKER_PORT` | Process configuration                                                                     |
| `EMAIL_*`, `SMTP_URL`, `OBJECT_STORAGE_*`          | Validated optional configuration for future adapters; no delivery/storage integration yet |
| `STRIPE_SECRET_KEY`, `SQUARE_ACCESS_TOKEN`         | Reserved, unused provider settings                                                        |
| `TEST_DATABASE_URL`, `TEST_REDIS_URL`              | Dedicated integration-test dependencies                                                   |

API and worker fail fast on invalid required configuration. Optional values should be omitted instead of set to empty strings. No application secret should be committed to the repository.

## Commands and tests

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm job:demo
```

Integration tests require `TEST_DATABASE_URL` with a database name ending in `_test` and `TEST_REDIS_URL` selecting `/15`. Compose initializes `lacquer_test` when its PostgreSQL volume is first created. Tests apply migrations and clean up their own uniquely named data; they never truncate the database. Playwright starts the built API/web automatically and registers a fresh test user; run migrations and build first. Browser tests leave their fake account/salon records in the development database.

```sh
pnpm db:generate # generate a migration after changing schema
pnpm db:migrate  # apply checked-in migrations; never use schema push as deployment
pnpm db:seed     # optional development seed
```

See [development](docs/development.md) for troubleshooting and [verification](docs/verification.md) for commands actually run in the implementation environment.

## API

Interactive docs: http://localhost:3001/docs/ (also proxied through web at `/docs/`). OpenAPI JSON: `/openapi.json`. API response contracts and request validation share Zod definitions.

| Method     | Path                                              | Access                                                           |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| GET        | `/health`, `/ready`                               | Process/dependency checks                                        |
| POST       | `/api/v1/auth/register`, `/api/v1/auth/login`     | Throttled public auth                                            |
| POST       | `/api/v1/auth/logout`                             | Revoke current session                                           |
| POST       | `/api/v1/auth/logout-all`                         | Authenticated; revoke all user's sessions                        |
| GET        | `/api/v1/me`                                      | Authenticated user                                               |
| GET        | `/api/v1/tenants`                                 | Current user's memberships with tenant and effective permissions |
| POST       | `/api/v1/tenants`                                 | Authenticated; atomically creates owner membership               |
| GET, PATCH | `/api/v1/tenants/:tenantId`                       | Member read; manage_business update                              |
| GET, POST  | `/api/v1/tenants/:tenantId/locations`             | Member list; manage_locations create                             |
| GET, PATCH | `/api/v1/tenants/:tenantId/locations/:locationId` | Member read; manage_locations update                             |

Milestone 2 salon operations. Reads require salon membership; writes require the
permission named. Money is an integer count of minor currency units (`7500` is
`$75.00`); durations and buffers are whole minutes.

| Method           | Path                                                                          | Access          |
| ---------------- | ----------------------------------------------------------------------------- | --------------- |
| GET, POST        | `/api/v1/tenants/:tenantId/staff`                                             | manage_staff    |
| GET, PATCH       | `/api/v1/tenants/:tenantId/staff/:staffId`                                    | manage_staff    |
| GET, PUT         | `/api/v1/tenants/:tenantId/staff/:staffId/locations`                          | manage_staff    |
| PUT              | `/api/v1/tenants/:tenantId/staff/:staffId/skills`                             | manage_staff    |
| GET, POST, PUT   | `/api/v1/tenants/:tenantId/staff/:staffId/schedule`                           | manage_staff    |
| PATCH, DELETE    | `/api/v1/tenants/:tenantId/staff/:staffId/schedule/:blockId`                  | manage_staff    |
| GET, POST        | `/api/v1/tenants/:tenantId/staff/:staffId/time-off`                           | manage_staff    |
| PATCH            | `/api/v1/tenants/:tenantId/staff/:staffId/time-off/:timeOffId`                | manage_staff    |
| GET, POST        | `/api/v1/tenants/:tenantId/staff/:staffId/availability-overrides`             | manage_staff    |
| DELETE           | `/api/v1/tenants/:tenantId/staff/:staffId/availability-overrides/:overrideId` | manage_staff    |
| GET              | `/api/v1/tenants/:tenantId/staff/:staffId/service-overrides`                  | manage_staff    |
| PUT              | `/api/v1/tenants/:tenantId/staff/:staffId/services/:serviceId/override`       | manage_staff    |
| PUT              | `/api/v1/tenants/:tenantId/staff/:staffId/services/:serviceId/eligibility`    | manage_staff    |
| GET, POST        | `/api/v1/tenants/:tenantId/categories`                                        | manage_services |
| GET, PATCH       | `/api/v1/tenants/:tenantId/categories/:categoryId`                            | manage_services |
| PUT              | `/api/v1/tenants/:tenantId/categories/order`                                  | manage_services |
| GET, POST        | `/api/v1/tenants/:tenantId/services`                                          | manage_services |
| GET, PATCH       | `/api/v1/tenants/:tenantId/services/:serviceId`                               | manage_services |
| PUT              | `/api/v1/tenants/:tenantId/services/:serviceId/locations`                     | manage_services |
| PUT              | `/api/v1/tenants/:tenantId/services/:serviceId/skills`                        | manage_services |
| PUT              | `/api/v1/tenants/:tenantId/services/:serviceId/add-ons`                       | manage_services |
| GET              | `/api/v1/tenants/:tenantId/services/:serviceId/staff`                         | Member read     |
| GET, POST        | `/api/v1/tenants/:tenantId/services/:serviceId/variants`                      | manage_services |
| PATCH            | `/api/v1/tenants/:tenantId/services/:serviceId/variants/:variantId`           | manage_services |
| PUT              | `/api/v1/tenants/:tenantId/services/:serviceId/variants/:variantId/skills`    | manage_services |
| GET, PUT, DELETE | `/api/v1/tenants/:tenantId/services/:serviceId/prerequisites`                 | manage_services |
| GET, POST        | `/api/v1/tenants/:tenantId/add-ons`                                           | manage_services |
| GET, PATCH       | `/api/v1/tenants/:tenantId/add-ons/:addOnId`                                  | manage_services |
| GET, POST        | `/api/v1/tenants/:tenantId/skills`                                            | manage_services |
| GET, PATCH       | `/api/v1/tenants/:tenantId/skills/:skillId`                                   | manage_services |
| GET, PATCH       | `/api/v1/tenants/:tenantId/scheduling-settings`                               | manage_settings |

`GET /services/:serviceId/staff` answers "who can perform this, and at what
price and length" — it resolves eligibility and the effective price, duration,
and buffers for every technician, with reasons for anyone excluded.

There are no deletion routes for catalog entities. Staff, services, categories,
variants, add-ons, and skills are deactivated with `active: false`; time off is
cancelled. Only configuration joins and schedule rows are removed outright.

All mutations require `Origin` matching APP_URL and `X-Lacquer-Request: 1`, including login and registration. Browser clients send credentials through same-origin cookies. Tenant creation is the bootstrap exception to membership validation: there is no existing tenant to validate, so creation inserts the creator's owner membership in the same transaction. No deletion routes are included; locations can be deactivated with PATCH.

## Architecture and next step

The backend owns authorization. Users are installation-wide identities; memberships join users to businesses. Every tenant-owned query must be scoped through validated context. Location timezone is independent of installation currency. Redis handles throttling and the demo queue; PostgreSQL remains the durable source of truth.

Read [architecture](docs/architecture.md) and [security](docs/security.md). Milestone 2 adds the salon-operations data model and admin workflows: the catalog, staff scheduling primitives, and pure domain rules with tenant-isolation tests. Milestone 3 adds the authoritative [booking engine](docs/booking-engine.md) and [concurrency protocol](docs/concurrency.md). Milestone 4 adds the [public customer experience](docs/public-booking.md); its [handoff](docs/handoff-milestone-4.md) records current verification and limitations.
