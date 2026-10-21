# ADR-006: Apply is a planned, idempotent reconcile with recorded intent

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
Changing a port or an environment variable on a running container requires recreating it; on ECS it requires a new task-definition revision and a service update. These are multi-step, non-atomic operations against remote systems that can time out. Retries from the UI or from a flaky network must not recreate a container twice or leave a member stopped with no record of why.

## Decision
Model every mutation as an `Operation` with an operator-supplied `Idempotency-Key`, claimed by a unique index in the same transaction that records the operation. The executor computes a plan as a pure function of desired state, observed state, and provider capabilities, then runs steps in order `INTERNAL → EXPOSED → ENTRY`, writing each step's intent before calling the provider. Each step has three outcomes: succeeded, failed, unknown. Failures roll back that member; unknown outcomes are never auto-retried and are reconciled by the next discovery pass. Same key with a different body is rejected (`422 IDEMPOTENCY_KEY_REUSED`); a concurrent apply on the same group is rejected (`409 OPERATION_IN_PROGRESS`). Keys are retained 30 days.

## Alternatives Considered

### Imperative endpoints per action (`/restart`, `/set-env`, `/map-port`)
- Pros: simple to understand one at a time
- Cons: no single place where the end state is known; partial failures leave the group in an undefined mix; retries duplicate side effects
- Rejected

### Generate a docker-compose file per group and run `compose up`
- Pros: familiar, declarative on Docker hosts
- Cons: compose does not cover ECS (the ECS compose integration is retired); compose takes ownership of containers it did not create poorly; harder to express member-level rollback
- Rejected: would split the model by runtime, defeating ADR-001

### Check for an existing operation, then act
- Pros: no unique index needed
- Cons: a time-of-check/time-of-use race under retry storms, which is precisely when duplicates are most expensive
- Rejected: the unique index is the mechanism

## Consequences
- The planner is unit-testable without infrastructure and its output is shown to the operator as a dry run before any apply.
- A crash mid-apply leaves evidence (step `RUNNING` or `UNKNOWN`) rather than a silent half-state.
- Operators must send an idempotency key; the console generates one per apply click and reuses it on retry.
- Operations are never hard-deleted; they are the audit trail.
