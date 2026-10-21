---
name: Berth product facts
description: User-stated scope, cadence and pending inputs for the Berth build.
---
- Scope (user's words, 2026-10-21): Docker containers on EC2/VPS over SSH AND ECS; "port" means port-mapping bookkeeping; "envs" means env vars + secrets; "integrate apps" means a shared network plus SVC_* injection. ECS is EC2 launch type (bridge); awsvpc is validate-only. The control plane runs as a Replit deployment reaching hosts outbound over SSH.
- Process: the user approved spec -> capability map -> architecture/ADRs -> plan (6 phases, 20 tasks, checkpoints A–F) and expects a report at each checkpoint before the next phase starts.
- Pending from the user when Phase 2 starts: a non-production SSH-reachable Docker host and an ECS cluster (EC2 launch type) for Checkpoints B and E.
- The user signed in during the first build and claimed the instance as first operator; a fresh deployment will do the same for whoever signs in first unless BERTH_OPERATORS is set.
