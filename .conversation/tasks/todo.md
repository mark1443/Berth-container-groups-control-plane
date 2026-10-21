# Berth v1 — Task List

Conventions: every task ends with `npm run check && npm run lint && npm test` green. Focused test command per task is given under Verification. No task touches more than ~5 files beyond tests. Sizes: S 1–2 files, M 3–5 files.

---

## Phase 1: Foundation

## Task 1: Project skeleton, schema v1, shared contracts, error shape and pagination

**Description:** Set up the single-process app (Express API serving the Vite console), Drizzle on Postgres with the v1 tables from `docs/architecture.md` §2, the `shared/contracts` package with Zod schemas for the common envelope (error shape, pagination), the error-translation middleware, and `GET /api/health`.

**Acceptance criteria:**
- [ ] `npm run dev` serves the console shell and `GET /api/health` returns `{ status: "ok", version }`
- [ ] Thrown `NotFoundError` / `ConflictError` / `ValidationError` / `ProviderError` become the single `{ error: { code, message, details? } }` shape with the mapped status
- [ ] `paginate()` helper returns `{ data, pagination }` with default `pageSize` 50, max 200, and rejects out-of-range input with `422 VALIDATION_ERROR`

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/errors.test.ts tests/integration/health.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: open the console shell in the browser; `curl /api/does-not-exist` returns the error shape with `404`

**Dependencies:** None

**Files likely touched:**
- `package.json`, `drizzle.config.ts`
- `server/index.ts`, `server/errors.ts`, `server/middleware/error.ts`
- `shared/schema.ts`, `shared/contracts/common.ts`
- `client/src/App.tsx`

**Estimated scope:** M

---

## Task 2: Provider interface, fake adapter, adapter contract test suite

**Description:** Define the `Provider` interface and `ProviderCapabilities` from `docs/architecture.md` §3 as the contract between core and runtimes. Implement the in-memory `fake` adapter with seedable workloads, networks, and failure injection. Write the contract test suite as a function `runProviderContractTests(factory)` so every adapter runs the same assertions.

**Acceptance criteria:**
- [ ] `server/providers/provider.ts` exports `Provider`, `ProviderCapabilities`, `ObservedWorkload`, `MemberPlan`, `MemberResult`, `WorkloadEvent`
- [ ] The fake adapter passes the full contract suite, including failure injection for `applyMember` and a `watch` that emits events
- [ ] Capabilities are declared per adapter and asserted by the suite (`canChooseHostPort`, `supportsNativeSecrets`, `serviceDiscovery`)

**Verification:**
- [ ] Tests pass: `npx vitest run tests/adapters`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: none (pure code)

**Dependencies:** Task 1

**Files likely touched:**
- `server/providers/provider.ts`
- `server/providers/fake/index.ts`
- `tests/adapters/provider.contract.ts`, `tests/adapters/fake.test.ts`

**Estimated scope:** M

---

## Task 3: Single-admin auth with session cookie and CSRF

**Description:** First-run setup creates the admin (username + password, Argon2id). Login issues an HTTP-only session cookie; mutations require a CSRF token; every `/api/*` route except `health`, `setup`, and `login` requires a session. Console gets Setup and Login pages and a signed-in shell.

**Acceptance criteria:**
- [ ] `POST /api/setup` works once and returns `409 ALREADY_SET_UP` afterwards
- [ ] Unauthenticated `GET /api/providers` returns `401 UNAUTHENTICATED`; after login it returns `200`
- [ ] A mutation without a valid CSRF token returns `403 CSRF_INVALID`

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/auth.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: set up, log out, log in, refresh — still signed in

**Dependencies:** Task 1

**Files likely touched:**
- `shared/schema.ts` (users, sessions), `shared/contracts/auth.ts`
- `server/routes/auth.ts`, `server/middleware/auth.ts`
- `client/src/pages/Login.tsx`, `client/src/pages/Setup.tsx`

**Estimated scope:** M

## Checkpoint A: After Tasks 1–3
- [ ] `npm run check && npm run lint && npm test` green
- [ ] Console shell served; error shape, pagination, auth, and contract suite tested
- [ ] Review with human before proceeding

---

## Phase 2: Providers and discovery

## Task 4: Envelope encryption module and credentials table

**Description:** Implement AES-256-GCM envelope encryption: per-row data keys wrapped by `BERTH_MASTER_KEY` (32 bytes, base64), `keyVersion` recorded, a `rotateMasterKey()` that re-wraps without re-encrypting values. Add the `credentials` table and a repository that only ever returns plaintext to the adapter asking for it.

**Acceptance criteria:**
- [ ] `encrypt()`/`decrypt()` round-trip; tampering with ciphertext or auth tag fails with `CryptoError`
- [ ] Rotation re-wraps every data key under the new master key and old ciphertexts still decrypt
- [ ] Startup fails fast with a clear message when `BERTH_MASTER_KEY` is missing or the wrong length

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/crypto.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: none

**Dependencies:** Task 1

**Files likely touched:**
- `server/crypto/envelope.ts`, `server/crypto/redact.ts`
- `shared/schema.ts` (credentials)
- `server/repositories/credentials.ts`

**Estimated scope:** M

---

## Task 5: Docker host registration over SSH with connectivity check

**Description:** `POST /api/providers` for `kind: DOCKER_HOST` with `transport: SSH` (host, port, user, private key) or `TCP_TLS` (host, port, CA, cert, key). The Docker adapter opens a pooled `dockerode` connection through `ssh2`, runs `ping` + `info`, and returns a `ConnectivityReport` (engine version, OS, container count, latency). Providers page lists providers with status and offers "Test connection". Plain `tcp://` is rejected at validation.

**Acceptance criteria:**
- [ ] Registering with bad credentials returns `201` with `status: OFFLINE` and a sanitised reason; good credentials return `ONLINE` with engine version
- [ ] `POST /api/providers/:id/connectivity-checks` re-runs the check and updates `status`/`lastSeenAt`
- [ ] `DELETE` returns `409 PROVIDER_HAS_GROUPS` when groups exist (groups table stubbed until Task 9)

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/providers.test.ts` (fake adapter) and, opt-in, `BERTH_TEST_DOCKER_HOST=ssh://user@host npx vitest run tests/adapters/docker.connectivity.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: register the non-production EC2/VPS host from the Providers page and see `ONLINE`

**Dependencies:** Tasks 2, 3, 4

**Files likely touched:**
- `shared/contracts/providers.ts`, `shared/schema.ts` (providers)
- `server/routes/providers.ts`, `server/providers/docker/connection.ts`, `server/providers/docker/index.ts`
- `client/src/pages/Providers.tsx`

**Estimated scope:** M

---

## Task 6: Workload inventory for Docker hosts

**Description:** Implement `listWorkloads`, `inspectWorkload`, and `watch` in the Docker adapter; a discovery poller (30 s) plus event subscription that upserts `workloads` and marks unseen ones `MISSING` after two passes; `GET /api/workloads` with filters and pagination; `GET /api/workloads/:id`; the Workloads page.

**Acceptance criteria:**
- [ ] Within 30 s of registering a host, every container (running and stopped) appears with name, image, status, ports, networks, labels, `envHash`
- [ ] A container stopped outside Berth is `STOPPED` on the next event and `MISSING` within 60 s if removed
- [ ] `GET /api/workloads?providerId=&status=&page=&pageSize=` filters and paginates; `envHash` present, env values never stored

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/workloads.test.ts tests/unit/discovery.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: `docker stop` a container on the test host; watch the Workloads page update

**Dependencies:** Task 5

**Files likely touched:**
- `shared/contracts/workloads.ts`, `shared/schema.ts` (workloads)
- `server/providers/docker/discovery.ts`, `server/jobs/discovery.ts`
- `server/routes/workloads.ts`, `client/src/pages/Workloads.tsx`

**Estimated scope:** M

---

## Task 7: ECS cluster registration and connectivity check

**Description:** `POST /api/providers` for `kind: ECS_CLUSTER` with region, cluster ARN, and either IAM access keys or a role ARN to assume. The ECS adapter validates with `sts:GetCallerIdentity`, `ecs:DescribeClusters`, and a dry `ecs:ListServices`, reports missing permissions by action name, and declares capabilities from the cluster's launch type and the task definitions' network modes (`bridge` → `canChooseHostPort: true`; `awsvpc` → `false`).

**Acceptance criteria:**
- [ ] Missing permissions produce `status: DEGRADED` with the list of denied actions in the `ConnectivityReport`
- [ ] Capabilities reflect the real network mode of the cluster's services
- [ ] `docs/aws-policy.json` is the least-privilege policy from `docs/architecture.md` §9 and the check passes with exactly that policy

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/providers.test.ts` (fake) and, opt-in, `BERTH_TEST_ECS_CLUSTER=... npx vitest run tests/adapters/ecs.connectivity.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: register the non-production cluster from the Providers page

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- `server/providers/ecs/client.ts`, `server/providers/ecs/index.ts`
- `shared/contracts/providers.ts` (ECS settings)
- `docs/aws-policy.json`
- `client/src/pages/Providers.tsx` (ECS form)

**Estimated scope:** M

---

## Task 8: ECS discovery

**Description:** Implement `listWorkloads` and `inspectWorkload` for ECS: `ListServices → DescribeServices → ListTasks → DescribeTasks`, task definitions cached by ARN. Each task becomes a `Workload` grouped under its service; ports from `portMappings`, `envHash` from the task definition's environment and secrets names.

**Acceptance criteria:**
- [ ] All running tasks of the cluster appear within one poll with service name, image, status, ports (container and host), network mode
- [ ] Task-definition descriptions are fetched once per ARN per process (cache hit counted in tests)
- [ ] A service scaled to 0 shows its tasks as `STOPPED`, then `MISSING`

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/ecs-discovery.test.ts` with recorded SDK fixtures; opt-in real cluster test
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: Workloads page shows both providers side by side

**Dependencies:** Tasks 6, 7

**Files likely touched:**
- `server/providers/ecs/discovery.ts`, `server/providers/ecs/fixtures/*.json`
- `server/jobs/discovery.ts` (poll-only path)
- `tests/unit/ecs-discovery.test.ts`

**Estimated scope:** M

## Checkpoint B: After Tasks 4–8 (real infrastructure, read-only)
- [ ] One real EC2/VPS host and one real ECS cluster (EC2 launch type) listed within 30 s with image, status, ports
- [ ] Drift half of success criterion 1 verified (`MISSING` within 60 s)
- [ ] No mutation code path exists yet
- [ ] Review with human before proceeding

---

## Phase 3: Groups and ports

## Task 9: Groups and members API with role validation

**Description:** `groups` and `group_members` tables and routes: create a group on one provider with `name`, `entryPort`, `protocol`; add members from that provider's workloads with `serviceName`, `role`, `containerPort`; validation that exactly one `ENTRY` exists before apply is allowed; a workload belongs to at most one group; `DELETE` releases ports (stub until Task 10) and schedules network release (stub until Task 15).

**Acceptance criteria:**
- [ ] Adding a second `ENTRY` returns `422 ENTRY_ALREADY_SET`; adding a workload from another provider returns `422 VALIDATION_ERROR`
- [ ] Adding a workload already in a group returns `409 WORKLOAD_IN_GROUP`
- [ ] `serviceName` is validated as DNS-safe and unique within the group

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/groups.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: none yet (UI in Task 11)

**Dependencies:** Task 6

**Files likely touched:**
- `shared/schema.ts` (groups, group_members), `shared/contracts/groups.ts`
- `server/routes/groups.ts`, `server/services/groups.ts`

**Estimated scope:** M

---

## Task 10: Port allocator

**Description:** `port_allocations` table with the partial unique index `(providerId, hostPort, protocol) WHERE state <> 'RELEASED'`; `claimPort()` as a single INSERT; advisory check against observed ports of unmanaged workloads; allocation of `EXPOSED` members from the per-provider range (default 20000–29999, configurable); `GET /api/groups/:id/ports`; capability-aware path that validates instead of choosing when `canChooseHostPort` is false.

**Acceptance criteria:**
- [ ] 20 parallel claims for the same port on one provider → exactly one `RESERVED` row, 19 × `409 PORT_IN_USE`
- [ ] A port bound by an unmanaged container on the host is refused with `409 PORT_IN_USE` and the offending container named in `details`
- [ ] On a provider with `canChooseHostPort: false`, an entry port different from the entry member's container port returns `422 CAPABILITY_NOT_SUPPORTED`

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/allocation.test.ts tests/integration/ports.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: none

**Dependencies:** Task 9

**Files likely touched:**
- `shared/schema.ts` (port_allocations + index migration)
- `server/services/allocation.ts`, `server/routes/groups.ts` (ports route)
- `tests/unit/allocation.test.ts`, `tests/integration/ports.test.ts`

**Estimated scope:** M

---

## Task 11: Groups page

**Description:** Console flow: create a group (provider, name, entry port), pick workloads from that provider, assign roles and `serviceName`, set container ports, see allocations and the group's status badge. Read-only "Plan" panel is wired in Task 14.

**Acceptance criteria:**
- [ ] The full create → add members → set roles flow works without leaving the page
- [ ] Validation errors from Task 9/10 render inline next to the field that caused them
- [ ] Port field is read-only with an explanation when the provider cannot choose host ports

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/client/groups.test.tsx`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: create group `shop` on the test host with `web` (ENTRY), `api`, `db`

**Dependencies:** Tasks 9, 10

**Files likely touched:**
- `client/src/pages/Groups.tsx`, `client/src/pages/GroupDetail.tsx`
- `client/src/components/MemberPicker.tsx`, `client/src/lib/api.ts`

**Estimated scope:** M

## Checkpoint C: After Tasks 9–11
- [ ] Success criterion 3 passes in integration tests
- [ ] Group `shop` exists in `DRAFT` on the test host with correct allocations
- [ ] Review with human before proceeding

---

## Phase 4: Config

## Task 12: Config entries API

**Description:** `config_entries` table and routes for group and member scopes; `MANUAL` values encrypted with Task 4's module; `AWS_SSM` / `AWS_SECRETS_MANAGER` entries validated by reference format and, when the provider is ECS or has AWS credentials, by a `GetParameter`/`DescribeSecret` dry call; `PATCH` takes a partial map where `null` deletes; reads return `valuePresent: true` and never the value.

**Acceptance criteria:**
- [ ] `GET` never returns a `value` for `isSecret: true`; a sentinel secret written in tests does not appear in any response or log line
- [ ] `PATCH` with `{ "A": "1", "B": null }` upserts `A` and deletes `B` in one transaction
- [ ] An unresolvable AWS reference returns `422 SECRET_REF_INVALID` with the action that failed

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/config.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: none yet (UI in Task 13)

**Dependencies:** Tasks 4, 9

**Files likely touched:**
- `shared/schema.ts` (config_entries), `shared/contracts/config.ts`
- `server/routes/config.ts`, `server/services/config.ts`

**Estimated scope:** M

---

## Task 13: Env renderer and Config page

**Description:** `renderEnv(group, member, entries, injectionVersion)` as a pure function: group entries, then member overrides, then injected `BERTH_*` and `SVC_*` variables that cannot be overridden; URL scheme per member; Config page with group and member tabs, secret toggle, and AWS reference picker.

**Acceptance criteria:**
- [ ] For group `shop` the renderer produces exactly the variables listed in `docs/architecture.md` §5 for member `api`
- [ ] A member entry named `SVC_DB_HOST` is rejected with `422 RESERVED_KEY`
- [ ] Config page saves, shows masked secrets, and marks the group as "changes not applied"

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/env.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: set `API_KEY` (secret) on `api`; confirm it is masked after save

**Dependencies:** Task 12

**Files likely touched:**
- `server/services/env.ts`
- `client/src/pages/Config.tsx`, `client/src/components/SecretField.tsx`
- `tests/unit/env.test.ts`

**Estimated scope:** M

## Checkpoint D: After Tasks 12–13
- [ ] Renderer and masking tested; storage half of success criterion 4 done
- [ ] Review with human before proceeding

---

## Phase 5: Integration and apply

## Task 14: Operations, idempotency, dry-run plan, apply planner

**Description:** `operations` table with unique `(groupId, idempotencyKey)`; `POST /api/groups/:id/applies` claims the key and allocations in one transaction and returns `202`; replay semantics (`200` original, `422 IDEMPOTENCY_KEY_REUSED`, `409 OPERATION_IN_PROGRESS`); `GET /api/operations`, `GET /api/operations/:id`; `GET /api/groups/:id/plan`; `planApply(desired, observed, capabilities)` as a pure function producing ordered steps (`ENSURE_NETWORK`, `APPLY_MEMBER`, `OPEN_INGRESS`, `RELEASE_PORT`, `RELEASE_NETWORK`) in `INTERNAL → EXPOSED → ENTRY` order, touching only members whose desired state differs.

**Acceptance criteria:**
- [ ] Same key + same body → `200` with the original operation id; same key + different body → `422`; concurrent apply → `409`
- [ ] Planner is deterministic and skips unchanged members (table-driven unit tests)
- [ ] `GET /api/groups/:id/plan` returns the steps without executing anything

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/apply-planner.test.ts tests/integration/applies.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: Plan panel on the Groups page shows the steps for `shop`

**Dependencies:** Tasks 10, 13

**Files likely touched:**
- `shared/schema.ts` (operations), `shared/contracts/operations.ts`
- `server/routes/applies.ts`, `server/routes/operations.ts`
- `server/services/apply-planner.ts`, `server/services/operations.ts`

**Estimated scope:** M

---

## Task 15: Docker adapter mutations

**Description:** `ensureNetwork` (user-defined bridge `berth-<group>`), `applyMember` implementing the recreate dance from `docs/architecture.md` §6 (inspect → create `.berth-next` with carried mounts, labels, command, restart policy + new env, port bindings, network alias → stop old → rename → start → health probe → remove prev), `rollbackMember`, and `releaseNetwork`. Health probe is TCP or HTTP through the SSH connection. Anonymous volumes are reported by the planner so Task 16 can refuse unless acknowledged.

**Acceptance criteria:**
- [ ] Against the fake and, opt-in, a real host: after `applyMember`, the container runs with the new env, bindings, and network alias, and the previous container is gone
- [ ] A failing health probe restores the previous container and leaves no `.berth-next` behind
- [ ] Mounts, labels, command, entrypoint, restart policy, and user are identical before and after (snapshot test on `inspect` output minus expected fields)

**Verification:**
- [ ] Tests pass: `npx vitest run tests/adapters/docker.mutations.test.ts` (fake-backed) and opt-in `BERTH_TEST_DOCKER_HOST=... npx vitest run tests/adapters/docker.real.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: recreate a throwaway `nginx` container on the test host via a scripted call; confirm with `docker inspect`

**Dependencies:** Tasks 6, 14

**Files likely touched:**
- `server/providers/docker/network.ts`, `server/providers/docker/recreate.ts`, `server/providers/docker/health.ts`
- `server/providers/docker/index.ts`
- `tests/adapters/docker.mutations.test.ts`

**Estimated scope:** M

---

## Task 16: Operation executor and Operations page

**Description:** Postgres-backed job runner that picks `PENDING` operations, executes steps in order, writes each step `RUNNING` before the provider call, records `SUCCEEDED`/`FAILED`/`UNKNOWN`, calls `rollbackMember` on failure, retries transport errors at most twice, never retries `UNKNOWN`, and moves allocations to `APPLIED` and the group to `APPLIED`/`FAILED`. Operations page shows a step timeline with redacted errors; Groups page gets the Apply button generating and reusing an idempotency key per click.

**Acceptance criteria:**
- [ ] Success criteria 2, 4 (apply half), 6, and 7 pass against the fake adapter in integration tests
- [ ] Killing the process mid-step and restarting leaves the step `UNKNOWN`, the operation `UNKNOWN`, and no automatic retry
- [ ] Retrying the Apply button after a network error reuses the key and does not create a second operation

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/executor.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: Apply `shop` on the test host; `curl http://<host>:8080` reaches `web`; `api` has `SVC_DB_HOST=db`

**Dependencies:** Tasks 14, 15

**Files likely touched:**
- `server/jobs/executor.ts`, `server/services/operations.ts`
- `client/src/pages/Operations.tsx`, `client/src/pages/GroupDetail.tsx` (Apply)
- `tests/integration/executor.test.ts`

**Estimated scope:** M

---

## Task 17: ECS adapter mutations

**Description:** `ensureNetwork` creates or reuses a Cloud Map HTTP namespace `berth-<group>`; `applyMember` registers a new task-definition revision (port mappings with allocated host ports in bridge mode, `environment`, `secrets[].valueFrom`, Service Connect configuration), calls `UpdateService`, and waits for stability with a bounded timeout; `OPEN_INGRESS` authorises the entry port on the container-instance security group; `rollbackMember` relies on the deployment circuit breaker and records the outcome.

**Acceptance criteria:**
- [ ] Success criterion 5 passes against recorded SDK fixtures and, opt-in, the real non-production service
- [ ] For a single-instance service in bridge mode the revision is deployed with `minimumHealthyPercent = 0`, `maximumPercent = 100`, and this is shown in the plan
- [ ] An `awsvpc` service with a mismatched entry port never reaches `applyMember` (rejected by Task 10's validation)

**Verification:**
- [ ] Tests pass: `npx vitest run tests/adapters/ecs.mutations.test.ts`; opt-in `BERTH_TEST_ECS_CLUSTER=... npx vitest run tests/adapters/ecs.real.test.ts`
- [ ] Build succeeds: `npm run check`
- [ ] Manual check: apply a group on the test cluster; confirm the new revision and the Service Connect namespace in the AWS console

**Dependencies:** Tasks 8, 16

**Files likely touched:**
- `server/providers/ecs/taskdef.ts`, `server/providers/ecs/service.ts`, `server/providers/ecs/network.ts`, `server/providers/ecs/ingress.ts`
- `tests/adapters/ecs.mutations.test.ts`

**Estimated scope:** M

---

## Task 18: Drift detector, group status transitions, Re-apply

**Description:** After each discovery pass, compare desired state of `APPLIED` groups with observed ports, network membership, and `envHash`; set `DRIFTED` with per-member reasons; never auto-correct. Group status machine `DRAFT → APPLYING → APPLIED | FAILED → DRIFTED → APPLYING`. Groups page shows drift reasons and a Re-apply action.

**Acceptance criteria:**
- [ ] Changing a member's env outside Berth flips the group to `DRIFTED` within two discovery passes with the reason `ENV_HASH_CHANGED`
- [ ] Re-apply produces a plan containing only the drifted members
- [ ] A `MISSING` member yields `DRIFTED` with `MEMBER_MISSING` and blocks apply until resolved

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/drift.test.ts tests/integration/drift.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: `docker stop web` on the test host; see `DRIFTED`, then Re-apply

**Dependencies:** Tasks 16, 17

**Files likely touched:**
- `server/jobs/drift.ts`, `server/services/groups.ts` (status machine)
- `client/src/pages/GroupDetail.tsx`
- `tests/unit/drift.test.ts`

**Estimated scope:** M

## Checkpoint E: After Tasks 14–18 (end to end on real infrastructure)
- [ ] Success criteria 2, 3, 4, 6, 7 on the real Docker host; criterion 5 on the real ECS service; criterion 1 drift path
- [ ] Review with human before proceeding

---

## Phase 6: Hardening and release

## Task 19: Redaction, audit, AWS policy, acceptance checklist, README

**Description:** `pino` redact paths plus value-based scrubber seeded with the current secret set; audit entries for every config change and operation (who, when, keys only for secrets); `docs/aws-policy.json` finalised; `docs/acceptance.md` with the eight success criteria as a manual checklist; README per `documentation-and-adrs` (quick start, commands, architecture pointer, ADR index).

**Acceptance criteria:**
- [ ] Integration test writes a sentinel secret, exercises every endpoint and an apply, and asserts the sentinel never appears in captured logs
- [ ] Audit log lists every mutation performed in the test run with actor and timestamp
- [ ] README quick start takes a fresh clone to a running dev server in the documented commands

**Verification:**
- [ ] Tests pass: `npx vitest run tests/integration/redaction.test.ts tests/integration/audit.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: follow the README on a clean checkout

**Dependencies:** Task 18

**Files likely touched:**
- `server/logger.ts`, `server/crypto/redact.ts`
- `shared/schema.ts` (audit_log), `server/services/audit.ts`
- `docs/acceptance.md`, `README.md`

**Estimated scope:** M

---

## Task 20: Replit deployment, secrets, production build, smoke test

**Description:** Deployment configuration for the single process (build + start commands, port), required secrets documented and set (`BERTH_MASTER_KEY`, `SESSION_SECRET`, `DATABASE_URL`), production build served by Express, a smoke test script that hits `/api/health`, logs in, and lists providers against the deployed URL.

**Acceptance criteria:**
- [ ] Deployed URL serves the console and `/api/health`; the smoke script passes
- [ ] Startup refuses to run without the required secrets, with a message naming the missing one
- [ ] SSH connectivity from the deployment to the test host verified from the Providers page

**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: run `scripts/smoke.sh <deployed-url>`

**Dependencies:** Task 19

**Files likely touched:**
- `.replit` / deployment config, `package.json` (scripts)
- `server/config.ts`, `scripts/smoke.sh`

**Estimated scope:** S

## Checkpoint F: Complete
- [ ] All eight success criteria met; coverage targets met (`npm test -- --coverage`)
- [ ] `SPEC.md`, `docs/architecture.md`, and ADRs updated for anything that changed during the build; new ADRs for new decisions
- [ ] Ready for release review
