# Implementation Plan: Berth v1

Status: **Approved** 2026-10-21 — implementation starts with Task 1. Spec approved 2026-10-21 (`SPEC.md`). Tasks are tracked in `tasks/todo.md`.

## Overview

Build Berth as one TypeScript deployable (React console + Express API + job runner on Postgres) that registers Docker hosts (SSH) and ECS clusters (EC2 launch type, AWS SDK), discovers workloads, groups them, allocates and records host ports from a single entry port, manages encrypted config with AWS-referenced secrets, and applies wiring through idempotent, logged operations. Work proceeds in the capability-map order — `providers → discovery → groups → config → integration → apply` — so the first four phases are read-only against infrastructure and the first real mutation happens only in Phase 5, after the planner, allocator, and operation model are unit-tested.

## Architecture Decisions

Recorded in `docs/decisions/`; summarised here so the plan reads standalone.

- **ADR-001** One `Provider` interface and a runtime-neutral `Workload` model; `docker`, `ecs`, and `fake` adapters pass the same contract suite.
- **ADR-002** Operator gives the entry port; internal members get no host port; exposed members get allocated ports; a partial unique index is the collision guard.
- **ADR-003** Config encrypted in Postgres (AES-256-GCM, wrapped data keys); SSM / Secrets Manager by reference; ECS passes ARNs natively, Docker hosts get values at apply time.
- **ADR-004** Per-group network (Docker user-defined bridge / ECS Service Connect) plus injected `SVC_*` variables, versioned per group.
- **ADR-005** TypeScript end to end, Express + Drizzle + Postgres, one process, no Redis; hosted as a Replit deployment reaching hosts over SSH.
- **ADR-006** Apply is a planned reconcile: idempotency key claimed by unique index, intent recorded before each provider call, three outcomes per step (succeeded / failed / unknown).

## Dependency Graph

```
shared/schema + shared/contracts (Task 1)
    │
    ├── Provider interface + fake adapter + contract suite (Task 2)
    │       ├── Docker adapter: connectivity (Task 5) → discovery (Task 7) → mutations (Task 15)
    │       └── ECS adapter: connectivity + discovery (Task 8) → mutations (Task 17)
    │
    ├── Auth (Task 3) ── every later route sits behind it
    │
    ├── Crypto + credentials (Task 4) ── providers API (Task 5), config values (Task 12)
    │
    ├── Groups + members (Task 9) ── allocator (Task 10) ── groups UI (Task 11)
    │       └── config entries (Task 12) ── env renderer (Task 13)
    │               └── operations + idempotency + planner (Task 14)
    │                       └── executor (Task 16) ── drift (Task 18)
    │
    └── hardening + docs (Task 19) ── deployment (Task 20)
```

Console pages are built inside the slice they belong to (vertical slicing), not as a separate phase.

## Task List

### Phase 1: Foundation (contract and skeleton)
- [ ] Task 1: Project skeleton, Postgres schema v1, shared contracts, error shape and pagination
- [ ] Task 2: Provider interface, fake adapter, adapter contract test suite
- [ ] Task 3: Single-admin auth with session cookie and CSRF

### Checkpoint A: Foundation
- [ ] `npm run check && npm run lint && npm test` green; `npm run dev` serves the console shell and `/api/health`
- [ ] Error shape and pagination tested; fake adapter passes the contract suite
- [ ] Review with human

### Phase 2: Providers and discovery (read-only against infrastructure)
- [ ] Task 4: Envelope encryption module and `credentials` table
- [ ] Task 5: Docker host registration over SSH with connectivity check (API + Providers page)
- [ ] Task 6: Workload inventory for Docker hosts: list, events, poller, `GET /api/workloads`, Workloads page
- [ ] Task 7: ECS cluster registration and connectivity check (IAM keys or AssumeRole)
- [ ] Task 8: ECS discovery: services, tasks, task definitions → workloads

### Checkpoint B: Real infrastructure, read-only
- [ ] One real EC2/VPS host over SSH and one real ECS cluster listed with image, status, ports within 30 s (success criterion 1, discovery half)
- [ ] A container stopped outside Berth shows `MISSING` within 60 s
- [ ] Review with human

### Phase 3: Groups and ports
- [ ] Task 9: Groups and members API with role validation (exactly one `ENTRY`)
- [ ] Task 10: Port allocator: partial unique index, observed-port advisory, concurrency test
- [ ] Task 11: Groups page: create group, pick workloads, set roles and entry port, view allocations

### Checkpoint C: Groups
- [ ] Success criterion 3 (409 `PORT_IN_USE`, 20 parallel requests → exactly one winner) passes in integration tests
- [ ] Review with human

### Phase 4: Config
- [ ] Task 12: Config entries API: scopes, encryption, masked reads, `PATCH` semantics, AWS reference validation
- [ ] Task 13: Env renderer (merge rules + `SVC_*` injection) and Config page

### Checkpoint D: Config
- [ ] Renderer unit tests cover override order and injection; secret values absent from logs and responses (criterion 4, storage half)
- [ ] Review with human

### Phase 5: Integration and apply (first mutations)
- [ ] Task 14: Operations, idempotency semantics, dry-run plan endpoint, apply planner as a pure function
- [ ] Task 15: Docker adapter mutations: `ensureNetwork`, `applyMember` recreate dance, `rollbackMember`, health probe
- [ ] Task 16: Operation executor job and Operations page with step timeline
- [ ] Task 17: ECS adapter mutations: task-definition revision, `UpdateService`, stability wait, security-group ingress
- [ ] Task 18: Drift detector, group status transitions, Re-apply

### Checkpoint E: End to end on real infrastructure
- [ ] Success criteria 2, 3, 4, 6, 7 on a real Docker host; criterion 5 on a real ECS service (EC2 launch type, bridge)
- [ ] Criterion 1 drift path verified end to end
- [ ] Review with human

### Phase 6: Hardening and release
- [ ] Task 19: Log redaction, audit entries, least-privilege AWS policy, acceptance checklist, README
- [ ] Task 20: Replit deployment configuration, secrets, production build, smoke test

### Checkpoint F: Complete
- [ ] All eight success criteria met; coverage targets met
- [ ] ADRs and `SPEC.md` updated for anything that changed during the build
- [ ] Ready for release review

## Verification Checkpoints Against Real Infrastructure

Tasks 5–8 and 15–18 need a real host or cluster to be *finished*, not just unit-tested. They are opt-in via `BERTH_TEST_DOCKER_HOST` (SSH URL) and `BERTH_TEST_ECS_CLUSTER` (cluster ARN + region). Before Checkpoint B the operator provides one **non-production** EC2/VPS host reachable over SSH and one **non-production** ECS cluster with at least one service on the EC2 launch type. Nothing in Phases 1–4 mutates them.

## Parallelization

- After Task 2, the ECS adapter work (Tasks 7–8, later 17) is independent of the Docker adapter work (Tasks 5–6, later 15) and can run in a second session.
- Console pages inside each slice can be built by a second session once that slice's contract in `shared/contracts` is committed.
- Must be sequential: schema changes (Tasks 1, 4, 9, 12, 14), the allocator (Task 10) before any apply (Task 16), the planner (Task 14) before the executor (Task 16).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SSH transport from Replit to hosts is blocked or flaky (firewalls, bastions) | High — Phase 2 cannot complete | Task 5 proves connectivity on a real host first; pooled connection with keepalive and backoff; clear `PROVIDER_UNREACHABLE` diagnostics with the exact SSH error |
| Docker recreate loses state (anonymous volumes, networks, custom labels) | High — data loss on the operator's containers | Carry mounts, labels, restart policy, command verbatim from `inspect`; refuse to apply when anonymous volumes are present unless acknowledged; always keep the previous container until the health probe passes |
| ECS bridge-mode rolling deployment collides on the same host port | Medium — deployment stuck | Set `minimumHealthyPercent = 0` for single-instance services; document; surface ECS service events in the operation |
| No Docker daemon in the development sandbox | Medium — adapter work tested only against fakes until a host is available | Fake adapter plus recorded `dockerode` fixtures; Checkpoint B requires a real host before any mutation task starts |
| Secret leakage through logs or error messages | High | Redaction at the logger seeded with current secret set; integration test greps logs for a sentinel secret and fails on a hit |
| Timeout mid-apply leaves `UNKNOWN` steps | Medium | Never auto-retry; discovery reconciles; Operations page shows exactly which member to inspect |
| `SVC_*` names become a contract before they are stable | Medium | `injectionVersion` per group from day one; prefix change is an "ask first" boundary |

## Open Questions

Carried from `SPEC.md` (1 and 4 resolved at approval). Proceeding on these defaults unless told otherwise:

- Public reachability on ECS: no ALB management in v1.
- Wiring on ECS: Service Connect with a Cloud Map namespace per group.
- Auth: single admin.
- Secret reveal: none.
- Scale: polling every 30 s plus Docker events.
- **New:** which non-production host and ECS cluster will be used for Checkpoints B and E, and when they are available.
