# Spec: Berth — container groups across Docker hosts and ECS

Status: **Accepted** — approved 2026-10-21. Decisions taken at approval: ECS uses the **EC2 launch type**; the control plane runs as a **Replit deployment** reaching hosts over SSH. Open questions 1 and 4 are resolved below; the rest proceed on the stated defaults until answered.
Companion documents: `CAPABILITY-MAP.md` (module boundaries and build order), `docs/architecture.md` (system design and API contract), `docs/decisions/` (ADRs).

## Objective

Berth is an internal tool for one operator or a small team who run applications as containers on a mix of Docker hosts (EC2 instances, VPSs) and ECS clusters, and who currently manage port mappings, environment variables, and app-to-app wiring by hand.

It does five things:

1. **Sees what is running.** Connect a Docker host or an ECS cluster; Berth lists every container or task with image, status, ports, and networks, and keeps that list current.
2. **Groups them.** Pick workloads on one host or cluster and name the set (for example `shop`: `web`, `api`, `db`).
3. **Takes one port and does the bookkeeping.** You give the group an entry port (say `8080`). The entry member gets it. Internal members get no host port at all. Members you mark as exposed get a free port allocated from a per-host range. Berth tracks every allocation and refuses collisions, so you never edit a port mapping by hand again.
4. **Manages env vars and secrets.** Set values per group or per member; keep them encrypted; or reference AWS SSM Parameter Store and Secrets Manager entries. Changes are applied to the running workloads.
5. **Wires the apps together.** Members of a group share a private network and find each other by name; each member receives the others' addresses as `SVC_<NAME>_HOST`, `SVC_<NAME>_PORT`, and `SVC_<NAME>_URL`, so nothing is hardcoded.

User stories

- As the operator, I register an EC2 host over SSH and an ECS cluster with an IAM role, and within 30 seconds I see both inventories in one screen.
- As the operator, I create group `shop` with port `8080`, add three containers, mark `web` as the entry, click Apply, and `curl http://<host>:8080` reaches `web`; `api` and `db` are reachable only from inside the group.
- As the operator, I change `DATABASE_URL` on `api`, click Apply, and only `api` is recreated with the new value; the value never appears in logs or in any API response.
- As the operator, I try to give a second group port `8080` on the same host and get a clear `PORT_IN_USE` error before anything touches the host.
- As the operator, when somebody stops a container with `docker stop` outside Berth, the group shows as drifted within a minute.

Non-goals for v1

- Deploying new images (pull and run). Berth manages what is already deployed. Deploy is the first candidate for v2.
- Kubernetes / EKS, multi-tenant accounts, role-based access control.
- Load balancer management (ALB listeners and target groups). On ECS, Berth records the entry port and opens the security-group rule; public routing through a load balancer stays manual in v1.
- Cross-provider groups. A group lives on one Docker host or one ECS cluster.
- Metrics and log streaming.

## Tech Stack

- **Language:** TypeScript end to end (one type system for the API contract, the console, and the adapters).
- **Console:** React 18 + Vite, TanStack Query, Tailwind. Served by the API process in production.
- **Control plane:** Node.js 20+, Express, Zod for boundary validation, `pino` logging with secret redaction.
- **State:** PostgreSQL via Drizzle ORM and `drizzle-kit` migrations. Operations and jobs are rows in Postgres; no Redis in v1.
- **Docker adapter:** `dockerode` over SSH (`ssh2`) or TCP with mutual TLS. Never plain TCP.
- **AWS adapter:** AWS SDK v3 — `@aws-sdk/client-ecs`, `client-ec2`, `client-servicediscovery`, `client-ssm`, `client-secrets-manager`, `client-sts`.
- **Crypto:** Node `crypto` AES-256-GCM for credentials and secret values at rest; master key from the `BERTH_MASTER_KEY` secret.
- **Tests:** Node's built-in test runner (`node --test`) for unit tests; `scripts/smoke.sh` drives every endpoint against the dev API with the fake provider. (Vitest/Supertest were dropped: the monorepo template ships neither, and the built-in runner needs no new dependency.)
- **Hosting (decided):** runs as a Replit deployment (web service + Postgres). It reaches Docker hosts outbound over SSH and AWS over the SDK, so no agent is installed on your hosts. Hosts must accept SSH from the internet (or through a bastion) for this to work. A Docker image for self-hosting inside a VPC remains a v2 option.

## Commands

```
Dev (API):    pnpm --filter @workspace/api-server run dev     # Express API on $PORT (proxied under /api)
Dev (web):    pnpm --filter @workspace/berth run dev          # Vite console on $PORT (proxied under /)
Build:        pnpm run build                                  # typecheck + build every package
Test (unit):  pnpm --filter @workspace/api-server test        # node --test over bundled test/*.test.ts
Smoke:        pnpm --filter @workspace/api-server smoke       # end-to-end run against the dev API (needs DATABASE_URL)
Typecheck:    pnpm run typecheck                              # libs (tsc --build) + every artifact
Codegen:      pnpm --filter @workspace/api-spec run codegen   # OpenAPI -> React Query hooks + Zod schemas
DB:           pnpm --filter @workspace/db run push            # apply the Drizzle schema to the dev database
```

Both dev servers are started by Replit workflows (`artifacts/api-server: API Server`, `artifacts/berth: web`); the preview proxy routes `/api/*` to the API and everything else to the console.

## Project Structure

Berth lives in a pnpm monorepo (the Replit template). The layout below replaces the original single-package `client/server/shared` sketch; the responsibilities are the same, the directories differ.

```
lib/
  api-spec/openapi.yaml        THE API contract: 28 paths, every request/response schema, one error shape
  api-zod/                     generated Zod schemas (server-side validation at the boundary)
  api-client-react/            generated fetch client + React Query hooks (console)
  db/src/schema/               Drizzle tables: providers, credentials, workloads, groups, group_members,
                               port_allocations, config_entries, operations, activity_events, operators, auth
  replit-auth-web/             useAuth() hook for the console
artifacts/
  api-server/src/
    index.ts                   process entry: HTTP server, stale-operation recovery, demo host, discovery poller
    app.ts                     Express app: logging, CORS, cookies, auth, routes, error handlers
    routes/                    one router per resource; validation at the boundary only
    services/                  use cases: providers, discovery, workloads, groups, allocator, config, plan, operations, overview
    providers/
      provider.ts              the Provider interface (contract between core and adapters)
      fake.ts                  in-memory runtime used by tests and the demo host
      registry.ts              kind/runtime -> adapter (Docker over SSH and ECS adapters arrive in Phase 2)
    middlewares/               Replit Auth session loader, requireOperator (401/403)
    lib/                       errors, pagination, crypto (AES-256-GCM), events, validate
  api-server/test/             unit tests (node --test); scripts/smoke.sh is the end-to-end run
  berth/src/                   React console: pages/, components/, lib/api.ts
docs/
  architecture.md              system design and API contract
  decisions/                   ADR-001 ... ADR-007
tasks/                         plan.md and todo.md
CAPABILITY-MAP.md
SPEC.md
```

## Code Style

```ts
// artifacts/api-server/src/services/allocator.ts
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { portAllocationsTable } from "@workspace/db";
import { ConflictError } from "../errors";

export type AllocationRequest = {
  providerId: string;
  groupId: string;
  memberId: string;
  hostPort: number;
  protocol: "TCP" | "UDP";
};

/**
 * Claims a host port for a group member.
 *
 * The claim is a single INSERT guarded by the partial unique index
 * (providerId, hostPort, protocol) WHERE state <> 'RELEASED'. We do not
 * SELECT first: two concurrent applies would both see "free" and both insert.
 * The index picks the winner; the loser gets ConflictError(PORT_IN_USE).
 */
export async function claimPort(req: AllocationRequest) {
  try {
    const [row] = await db
      .insert(portAllocations)
      .values({ ...req, state: "RESERVED" })
      .returning();
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError("PORT_IN_USE", `Port ${req.hostPort}/${req.protocol} is already allocated on this host`);
    }
    throw err;
  }
}
```

Conventions

- `camelCase` for variables, fields, and query params; `PascalCase` for types; `UPPER_SNAKE` for enum values and error codes; `kebab-case` for files and module ids.
- Validate with Zod in route handlers only; services receive typed, trusted input.
- Errors are thrown as typed classes (`NotFoundError`, `ConflictError`, `ValidationError`, `ProviderError`) and translated to the single HTTP error shape in one middleware.
- No `any`; `unknown` plus narrowing at boundaries. No commented-out code; no TODOs that could be done now.
- Comments explain why. Gotchas (for example "containers are immutable: a port or env change requires recreate") are documented where they bite.
- Secret values never reach a log line, an error message, or a response body. The redaction helper is applied at the logger, not at call sites.

## Testing Strategy

| Level | Tool | What it covers | Where |
|---|---|---|---|
| Unit | Vitest | Port allocator, env renderer (`SVC_*` injection, merge rules), apply planner (desired vs observed → steps), crypto, redaction | `tests/unit` |
| Integration | `scripts/smoke.sh` (curl + jq) against the dev API and Postgres | Every endpoint in `lib/api-spec/openapi.yaml`: validation, error shape, pagination, idempotency replay, 409 on port collision, 12-way port race | `artifacts/api-server/scripts/smoke.sh` |
| Adapter contract | Vitest, same suite run against `fake`, `docker`, and `ecs` | The Provider interface behaves identically across adapters | `tests/adapters` |
| Manual acceptance | Checklist in `docs/acceptance.md` | Success criteria below against a real EC2 host and a real ECS service | before each release |

Coverage targets: 90% lines on `services/allocator.ts`, `services/config.ts`, `services/plan.ts`, `lib/crypto.ts`; 70% overall (coverage tooling is added when the Docker adapter lands). Adapter tests against a real Docker daemon or ECS cluster are opt-in (`BERTH_TEST_DOCKER_HOST`, `BERTH_TEST_ECS_CLUSTER`) and never run in CI by default.

## Boundaries

Always

- Validate at the API boundary with the generated Zod schemas in `lib/api-zod`; change `lib/api-spec/openapi.yaml` first, re-run codegen, then implement — contract and implementation land together.
- Encrypt credentials and secret values before they reach Postgres; mask them in every response (`valuePresent: true`, never the value).
- Run every runtime mutation as an `Operation` with an idempotency key and a step log; record intent before calling out.
- Run `pnpm run typecheck && pnpm --filter @workspace/api-server test` before each commit; keep new API fields optional and additive.
- Write or update an ADR when choosing a dependency, changing the data model, or changing provider semantics.

Ask first

- Adding a dependency; adding Redis or any second datastore.
- Schema changes after the first migration ships.
- Any operation against an ECS service whose cluster is tagged `env=prod`, until the operator has run at least one successful apply on a non-prod cluster.
- Load balancer, DNS, or IAM policy changes beyond the documented least-privilege policy.
- Changing the `SVC_*` injection prefix or env merge rules (consumers will depend on them — Hyrum's Law).

Never

- Commit secrets, keys, or `.env` files; log a secret value; return a secret value from the API.
- Touch a container or task that is not a member of a group (no `docker rm -f` on unmanaged workloads).
- Expose a Docker daemon over plain TCP, or store a Docker socket path that is not the control plane's own.
- Remove a failing test or lower a coverage threshold to make a build pass.
- Hard-delete an `Operation` or an ADR.

## Success Criteria

1. **Discovery.** After registering a Docker host (SSH) and an ECS cluster, `GET /api/workloads` lists every running container and task with image, status, and ports within 30 s, and reflects a container stopped outside Berth as `MISSING` within 60 s.
2. **Group + port.** Creating group `shop` (entry port 8080) on a Docker host with members `web` (ENTRY, container port 3000), `api` (INTERNAL, 4000), `db` (INTERNAL, 5432), then applying, results in: `curl http://<host>:8080` served by `web`; `api` and `db` with no host port bindings; all three attached to network `berth-shop`; `api` with `SVC_DB_HOST=db`, `SVC_DB_PORT=5432`, `SVC_WEB_URL=http://web:3000` in its environment.
3. **Collision safety.** A second group requesting entry port 8080 on the same host receives `409 { error: { code: "PORT_IN_USE" } }` before any provider call; the partial unique index on `(providerId, hostPort, protocol)` enforces this under concurrency (tested with 20 parallel requests, exactly one wins).
4. **Config.** Setting secret `API_KEY` on `api` and applying recreates only `api`; the value is absent from logs and from `GET /api/groups/:id/members/:memberId/config` (`valuePresent: true`).
5. **ECS (EC2 launch type, bridge networking).** Applying a group on an ECS service registers a new task-definition revision with the environment, `secrets` (SSM / Secrets Manager ARNs passed through), port mappings whose host ports come from Berth's allocations, and Service Connect configuration, updates the service, and waits for it to be stable; the entry port has an ingress rule on the container instance security group.
6. **Idempotency.** Re-sending `POST /api/groups/:id/applies` with the same `Idempotency-Key` returns the original operation (`200`, same `id`) and performs no second recreate; the same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.
7. **Rollback.** If a recreated container fails its health check, Berth restarts the previous container and marks the operation `FAILED` with the step that failed; no member is left stopped.
8. **Quality gates.** `pnpm run typecheck` and the unit tests pass; the smoke run is green; every path in `lib/api-spec/openapi.yaml` is exercised by the smoke run or an integration test.

## Open Questions

1. ~~**ECS launch type.**~~ **Resolved: EC2 launch type.** With bridge networking Berth allocates host ports on ECS exactly as on Docker hosts. Task definitions that use `awsvpc` are still supported in validate-and-record mode (`canChooseHostPort = false`). Fargate is not targeted.
2. **Public reachability on ECS.** With no load balancer management in v1, the entry port is reachable on the container instance's address (bridge mode maps it onto the EC2 host) or through whatever ALB you already have. Default until answered: ALB target-group registration stays out of v1.
3. **Service Connect.** Per-group wiring on ECS uses ECS Service Connect with a Cloud Map namespace per group (supported with bridge networking on the EC2 launch type). If you already use Cloud Map or App Mesh, Berth should match it instead. Default until answered: Service Connect.
4. ~~**Where the control plane runs.**~~ **Resolved: Replit deployment.** Berth reaches Docker hosts over SSH and AWS over the SDK from Replit. Each registered host needs inbound SSH from Berth's egress (a bastion or an allow-list on port 22).
5. **Auth.** v1 proposes a single admin login (username + password, session cookie). Default until answered: single admin.
6. **Secret reveal.** v1 never shows a stored secret value again after it is saved. Default until answered: no reveal action.
7. **Scale.** Roughly how many hosts, clusters, and containers? The 30 s polling design is comfortable up to a few hundred workloads. Default until answered: polling plus Docker events.
