# ADR-005: TypeScript end to end, Express + Postgres, single deployable, no Redis

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
The tool has a web console, an HTTP API, background discovery, and a job runner that performs long-running applies. The team is small; operational simplicity matters more than peak throughput. The control plane needs good client libraries for the Docker Engine API and for AWS.

## Decision
Build everything in TypeScript: React + Vite console, Express API with Zod validation, Drizzle ORM on PostgreSQL, `dockerode` for Docker, AWS SDK v3 for ECS and related services. Ship as one process that serves the console, the API, and the job runner, with operations and jobs persisted in Postgres (no Redis, no external queue). Run it as a Replit deployment (decided at approval), reaching Docker hosts outbound over SSH and AWS over the SDK. A Docker image for self-hosting inside a VPC is a v2 option, not part of v1.

## Alternatives Considered

### Go
- Pros: native fit for Docker tooling (the Docker client is Go), single static binary, strong concurrency
- Cons: two languages once the React console exists; contract types would be duplicated or generated; slower iteration for a solo operator
- Rejected: shared Zod contracts across API and console are worth more here than Go's runtime advantages

### Python (FastAPI)
- Pros: fast to write, good AWS SDK
- Cons: weaker Docker client ecosystem for streaming events, two languages with the console
- Rejected for the same reason as Go

### Separate worker process with Redis-backed queue (BullMQ)
- Pros: isolation of long-running applies, horizontal scaling
- Cons: a second datastore to run and secure; the expected load (tens of hosts, hundreds of workloads) does not need it
- Rejected for v1: the job table design allows extracting a worker later without changing semantics

## Consequences
- One `npm run dev` runs the whole system; tests use the fake provider and a real Postgres.
- Long applies run inside the API process; the operation table makes them resumable after a restart.
- Hosts must accept SSH from Berth's egress; hosts in private subnets need a bastion. If that becomes a blocker, the self-hosted image moves into scope.
