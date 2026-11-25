# SampIntel AI

Authorized synthetic research and survey QA for the Sampledge ecosystem. SampIntel AI tests survey logic, branching,
validation, localization, redirects and regression using fictional profiles and clearly labelled synthetic records.
It is independent of Supply360: its own repository, database, credentials, queues, limits and exports. It never sees
real panel identities or human participation tokens, and its results never count toward human quotas, IR, rewards or
delivery.

> **Status: Phase 1 (foundations).** Tenants, sign-in with required two-step verification, eleven roles with a
> SampIntel permission matrix (separation of duties: whoever runs QA cannot approve its authorization), row-level
> tenant isolation, an append-only audit log, settings (default target: sandbox), notifications, the design system
> with four themes and the app shell. The QA modules (Authorization Centre, execution engine, synthetic data engine,
> model gateway and budgets) arrive in Phase 6 and open a status page until then. The overall plan lives in the
> Supply360 repository: `docs/phase0/05-plan-and-traceability.md`.

## What it will never do

Automate surveys without verified owner authorization, impersonate real respondents, rotate IPs or spoof
fingerprints, bypass CAPTCHA or other security systems, imitate human timing to avoid detection, or fabricate human
completes. Workers stop on any security challenge, expiry, revocation, session or budget limit, unexpected navigation
or emergency stop.

## Quick start

Requirements: Node 26.13.1 LTS, pnpm 12.23.0, Docker (or PostgreSQL 18 and Redis 8).

```bash
cp .env.example .env                       # fill every CHANGE-ME
docker compose up -d postgres redis
pnpm install
pnpm build
docker compose exec postgres psql -U postgres -d sampintel -c "create role si_api login password '<SI_API_DB_PASSWORD>'"
pnpm db:migrate
docker compose exec postgres psql -U postgres -d sampintel -c "grant si_app to si_api"
pnpm db:seed:demo                          # optional: DEMO tenant `demo`, fictional accounts
pnpm dev                                   # web http://localhost:3100 · API http://localhost:4100/api/v1
```

Ports 3100/4100 let SampIntel AI run next to Supply360 (3000/4000) on one machine.

## Tests

```bash
pnpm test                 # unit: role matrix and separation of duties, sealing, theme contrast, module registry
pnpm test:integration     # API against real Postgres, including cross-tenant isolation
pnpm --filter @si/web e2e # browser test + axe on a running stack (E2E_PASSWORD=…)
```

## Layout

```
apps/api            NestJS 12 API, OpenAPI at /api/v1/openapi.json
apps/web            Next.js 16 App Router, Tailwind 4, Radix, cmdk; four themes (Neural Violet by default)
packages/contracts  zod schemas shared by API and web
packages/db         Drizzle schema and SQL migrations, including row-level security
```

## Load test

`apps/api/src/scripts/load-test.ts` creates a throwaway `loadtest-*` tenant with 20 Tenant Admin accounts, signs
them all in with MFA, then runs a weighted read/write mix (40% `/auth/me`, 20% `/users`, 20% `/audit`, 15%
`/notifications`, 5% `PUT /settings/tenant`) at several concurrency levels and prints throughput, errors, status
codes and p50/p95/p99 latency. It refuses to run with `NODE_ENV=production`.

```sh
# The API's per-address limits would (correctly) reject a single-machine load run, so raise them for this run only.
LOGIN_RATE_LIMIT=1000 API_RATE_LIMIT=10000000 pnpm --filter @si/api start
DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/sampintel \
  pnpm --filter @si/api load-test -- --levels 10,50,100 --duration 15
```

Flags: `--base`, `--users`, `--levels`, `--duration`, `--json`.
