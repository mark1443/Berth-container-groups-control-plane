# Berth

Berth is an operator console for containers you already run: it discovers Docker containers (EC2/VPS over SSH) and ECS tasks, groups them, hands each group a single entry port and records every host port it uses, manages environment variables and secrets per group and per member, and wires members together over a shared network with injected `SVC_*` variables — every change goes through a dry-run plan and an idempotent, audited apply.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API (Express) on `$PORT`, proxied under `/api` (workflow `artifacts/api-server: API Server`)
- `pnpm --filter @workspace/berth run dev` — React console on `$PORT`, proxied under `/` (workflow `artifacts/berth: web`)
- `pnpm run typecheck` — libs (`tsc --build`) + every artifact
- `pnpm --filter @workspace/api-server test` — unit tests (Node's built-in runner; `test/run.mjs` bundles `test/*.test.ts` with esbuild first)
- `pnpm --filter @workspace/api-server smoke` — 61-check end-to-end run against the dev API and the demo host (needs `DATABASE_URL`, `REPLIT_DEV_DOMAIN`; creates and removes a throwaway operator session)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod schemas + React Query client from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push the Drizzle schema (dev only)
- Env: `DATABASE_URL`, `SESSION_SECRET` (required). Optional: `BERTH_MASTER_KEY` (32-byte base64/hex; HKDF of `SESSION_SECRET` is used with a boot warning when absent), `BERTH_OPERATORS` (comma-separated Replit user ids or e-mails), `BERTH_DEMO=0` to skip seeding the fake `demo-host`, `BERTH_DISCOVERY_INTERVAL_MS` (default 30000).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, Drizzle ORM on PostgreSQL, Zod (`zod/v4`), pino
- Console: React 19 + Vite, wouter, TanStack Query, Tailwind v4, shadcn/ui, Lucide, Bricolage Grotesque / Plus Jakarta Sans / JetBrains Mono
- Auth: Replit Auth (OIDC, `lib/replit-auth-web` + `artifacts/api-server/src/middlewares`)
- Codegen: Orval (OpenAPI → `lib/api-zod`, `lib/api-client-react`)

## Where things live

- `SPEC.md`, `CAPABILITY-MAP.md`, `docs/architecture.md`, `docs/decisions/ADR-001…007`, `tasks/plan.md`, `tasks/todo.md` — product spec, design, decisions, and the 6-phase / 20-task plan (Phase 1 done; Checkpoint A).
- `lib/api-spec/openapi.yaml` — the API contract (source of truth; change it first, then run codegen).
- `lib/db/src/schema/` — Drizzle tables: providers, credentials, workloads, groups, group_members, port_allocations, config_entries, operations, activity_events, operators, sessions/users (auth).
- `artifacts/api-server/src/` — `routes/` (one router per resource), `services/` (providers, discovery, workloads, groups, allocator, config, plan, operations, overview), `providers/` (`provider.ts` interface, `fake.ts` runtime, `registry.ts`), `middlewares/` (auth, `requireOperator`), `lib/` (errors, pagination, crypto, events), `demo.ts` (seeds `demo-host`), `scripts/smoke.sh`, `test/`.
- `artifacts/berth/src/` — console: `pages/` (overview, providers, workloads, groups, group detail, operations, auth), `components/`, `lib/api.ts` (query client, access-state signal, formatters), `index.css` (theme tokens).

## Architecture decisions

- The OpenAPI document is the contract and everything is generated from it (reverse of the original "Zod first" sketch). Consequence: config `PATCH` bodies are `{ set: [...], remove: [...] }`, not a map with `null` deletes.
- Ports are a ledger: a `port_allocations` row per `(provider, port, protocol)` guarded by a partial unique index; claims use `INSERT … ON CONFLICT DO NOTHING` so a losing claim is a clean `409 PORT_IN_USE` instead of an aborted transaction. The entry port is reserved when the group is created and later linked to whichever member holds `ENTRY`.
- Apply is a planned reconcile (ADR-006): `Idempotency-Key` required, same key + same body replays with `200`, different body is `422 IDEMPOTENCY_KEY_REUSED`, a running apply is `409 OPERATION_IN_PROGRESS`; each step's outcome is written before the next starts; stale `PENDING/RUNNING` operations become `UNKNOWN` on boot.
- Drift: only `APPLIED`/`DRIFTED` groups change status on re-plan; `DRAFT`/`FAILED` keep theirs. An unmanaged container on the entry port is a plan warning, not a conflict.
- Auth (ADR-007): Replit Auth session + operator allow-list. `BERTH_OPERATORS`, else the first account to sign in claims the instance. `401 UNAUTHENTICATED` vs `403 FORBIDDEN`.
- Secrets: AES-256-GCM with the record id as AAD; secret values are never returned by the API (`valuePresent: true`, masked in rendered env).
- Docker-over-SSH and ECS adapters are Phase 2; registering those providers today stores sealed credentials and reports `OFFLINE` with a clear message.

## Product

- Overview (counts, drift, recent activity), Providers (register Docker host / ECS cluster, connectivity check, discovery, port usage), Workloads (search, managed filter, detail), Groups (create with entry port, members with roles ENTRY/INTERNAL/EXPOSED, config per group/member with secrets, rendered env, plan, apply, operations history with per-step outcomes), Operations and Activity.
- A fake `demo-host` with seven containers is seeded in development so every flow can be exercised without infrastructure.

## User preferences

- Follow the four addyosmani agent-skills (spec, capability map, architecture + ADRs, plan + task list) and report at each checkpoint before continuing.
- Both Docker (EC2/VPS over SSH) and ECS (EC2 launch type; awsvpc validate-only) are in scope; the control plane runs as a Replit deployment reaching hosts outbound.

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, run codegen, then `pnpm run typecheck`; shared libs referenced from app tsconfigs must stay `composite: true`.
- Orval's `zod.coerce.boolean()` treats `"false"` as `true`; boolean query flags (e.g. `managed`) are parsed by hand in the route.
- Never throw inside a Drizzle transaction expecting to continue — a raised unique violation aborts the whole transaction. Use `ON CONFLICT DO NOTHING … RETURNING` and check the result.
- The smoke script inserts and removes a throwaway `smoke-tester` operator row; never delete the real operator row.
- Changing a group through the API while the demo runtime's containers were modified by a previous apply is realistic (containers keep their last published ports after a group is deleted), so tests must not assume a fresh range port is the first one.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
