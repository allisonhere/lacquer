# Development

Use the root README quick start. Run commands from the repository root. Pin pnpm through the packageManager field; CI and Docker use Node 22. Backend packages execute TypeScript with tsx; root build checks them and emits the SvelteKit adapter-node server.

## Database changes

Edit `packages/db/src/schema.ts`, run `pnpm db:generate`, and inspect the SQL and metadata. Commit schema, SQL, and metadata together. Apply with `pnpm db:migrate`; don't edit already-applied migrations. Seed uses conflicts to remain repeatable and refuses production mode.

The test database initializer only runs on a fresh Postgres volume. If your existing development volume predates it, create the separate database explicitly:

```sh
docker compose exec postgres createdb -U lacquer lacquer_test
```

Do not remove data volumes simply to create a test database. Production backup/restore and migration rollout procedures remain installation responsibilities.

## Testing

- `pnpm test`: permission defaults/toggles, environment validation, tenant request contracts and parameterized scope tests. Booking-engine has an explicit todo placeholder, not fabricated booking logic.
- `pnpm test:integration`: real PostgreSQL/Redis tests. Dedicated test URLs are required; suite cleans only records it creates. It tests auth, tenants, locations, cross-tenant substitution, permission revocation, disabled tenants, and token replay.
- `pnpm build && pnpm test:e2e`: Playwright smoke against the built application. Run `pnpm exec playwright install chromium` first (Linux CI uses `--with-deps`). Existing local app servers may be reused outside CI. Shut down stale processes if they use different environment settings.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`: static checks. Use `pnpm format` to apply formatting.

The browser test creates unique fake accounts rather than relying on seed credentials. Integration tests use a separate Redis DB `/15` for limiter keys. Avoid parallel runs of integration suites against the same Redis database because their IP throttles share keys.

## Local services

`pnpm dev` starts all three apps. API binds 3001, Vite/web 5173, and worker health 3002. `pnpm job:demo` enqueues `demo.ping`; inspect worker logs or its health route. Completed/failed demo jobs retain only the most recent 100 records.

Compose DNS names (`postgres`, `redis`, `api`) are only valid inside Compose; native `.env` uses localhost. Web has a fixed server-side `API_INTERNAL_URL` and never exposes database/Redis secrets to browser code. The browser always uses `/api/v1` on its own origin.

## Troubleshooting

- 403 CSRF_REJECTED: APP_URL must exactly match the browser origin, including protocol and port. localhost and 127.0.0.1 differ. Send X-Lacquer-Request: 1 on writes.
- 401: the cookie expired, was revoked, or SESSION_SECRET changed. Sign in again.
- 404 for a tenant/resource: no active membership or the record is outside the validated tenant. The API deliberately hides tenant existence.
- 409: email, tenant slug, or tenant-local location slug already exists.
- 503: inspect database/Redis connectivity with `/ready` and structured logs.
- Docker socket denied: obtain Docker access through your host environment; Compose cannot start without it.
- Locked ports: stop the duplicate native/Compose app, or consistently adjust app URLs, ports, and E2E configuration.

## Scope

No custom roles, membership-management UI, email sending, provider integrations, booking logic, payments, calendar, or client management is implemented. The UI is deliberately small. Changes should preserve the shared contracts and tenant-isolation invariant.
