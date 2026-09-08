# Lacquer

Open-source, multi-tenant salon software. Nail salons first, with a foundation that can support other beauty businesses later. Self-hostable and suitable for a future Lacquer Cloud service.

**Milestone 1: project foundation.** Account authentication, business memberships, fixed permissions, and location setup are implemented. Booking, payments, CRM, calendars, loyalty, waitlists, gift cards, and provider integrations are intentionally absent. This is a foundation preview, not a complete salon booking product.

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

The seed is repeatable. It creates two example salons, one location in each, and an owner and technician with memberships in both. It does not overwrite existing passwords.

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

Open http://localhost:5173. `pnpm dev` loads the root `.env` and runs web, API, and worker with reloads. All services are started explicitly; no hidden host services are required.

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
  booking-engine/      Reserved pure-domain package; no booking implementation
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

All mutations require `Origin` matching APP_URL and `X-Lacquer-Request: 1`, including login and registration. Browser clients send credentials through same-origin cookies. Tenant creation is the bootstrap exception to membership validation: there is no existing tenant to validate, so creation inserts the creator's owner membership in the same transaction. No deletion routes are included; locations can be deactivated with PATCH.

## Architecture and next step

The backend owns authorization. Users are installation-wide identities; memberships join users to businesses. Every tenant-owned query must be scoped through validated context. Location timezone is independent of installation currency. Redis handles throttling and the demo queue; PostgreSQL remains the durable source of truth.

Read [architecture](docs/architecture.md) and [security](docs/security.md). Recommended Milestone 2: service catalog, staff scheduling primitives, and pure booking-domain rules with tenant-isolation tests, before building the public booking flow. No Milestone 2 behavior is implemented here.
