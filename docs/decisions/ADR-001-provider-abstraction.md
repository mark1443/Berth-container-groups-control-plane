# ADR-001: One Workload model over two runtimes (Docker Engine API and ECS)

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
The operator runs containers on Docker hosts (EC2 instances and VPSs) and on ECS (EC2 launch type). The two runtimes have different control surfaces: Docker exposes containers and networks through the Engine API on each host; ECS exposes services, tasks, and task definitions through the AWS API, and the control plane has no socket access to ECS container instances. Groups, port bookkeeping, config, and wiring must behave the same from the operator's point of view regardless of where a workload runs.

## Decision
Define a single `Provider` interface and a runtime-neutral `Workload` model in the core. Ship two adapters, `docker` (dockerode over SSH or mutual TLS) and `ecs` (AWS SDK v3), plus an in-memory `fake` adapter for tests. Runtime differences are declared through `ProviderCapabilities` (for example `canChooseHostPort`, `supportsNativeSecrets`) and consumed by the planner and the UI, rather than special-cased in core code. No agent is installed on hosts; all access is outbound from the control plane.

## Alternatives Considered

### Docker hosts only
- Pros: one adapter, simpler port model, events stream everywhere
- Cons: leaves the ECS workloads unmanaged, which is half of the operator's estate
- Rejected: does not meet the requirement

### An agent on every host (Kubernetes-style node agent)
- Pros: local socket access, push-based discovery, no SSH management
- Cons: one more thing to install, upgrade, and secure on every host; impossible on Fargate anyway
- Rejected: operational burden with no benefit for ECS

### Embed or wrap Portainer
- Pros: mature Docker management UI exists today
- Cons: no concept of groups with a single entry port, no allocation bookkeeping, ECS support is not a first-class model; the custom semantics would live outside it anyway
- Rejected: the valuable parts of this tool are exactly what Portainer does not model

## Consequences
- Core services and the planner are testable against the fake adapter without any infrastructure.
- Each adapter must pass the same contract test suite, which keeps behaviour aligned.
- Capability flags push runtime limits (Fargate port rigidity) to validation time instead of apply time.
- Adding a third runtime later (for example Kubernetes) means one adapter, not a core rewrite.
