# ADR-004: Per-group private network plus injected SVC_* variables

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
Apps in a group need to reach each other without hardcoded addresses. Docker provides DNS by container name or alias on user-defined networks; ECS provides Service Connect (backed by Cloud Map) for the same purpose. Apps are existing containers that cannot be modified, so wiring must arrive through configuration they already read: environment variables.

## Decision
Each group gets a private network: a user-defined bridge network `berth-<group>` on Docker hosts, or an ECS Service Connect namespace `berth-<group>` on ECS. Members are reachable by their `serviceName`. On apply, every member receives `SVC_<NAME>_HOST`, `SVC_<NAME>_PORT`, and `SVC_<NAME>_URL` for each other member, plus `BERTH_GROUP`, `BERTH_SELF`, and `BERTH_SELF_PORT`. Injected variables are added after config merge and cannot be overridden. The naming scheme is versioned per group (`injectionVersion`) and never changed in place.

## Alternatives Considered

### Consul or another service registry
- Pros: health-aware discovery, works across hosts
- Cons: another system to run; apps would need a client or a sidecar; cross-host groups are out of scope in v1
- Rejected: heavier than the problem

### Sidecar proxy per member (service mesh style)
- Pros: retries, mTLS, observability for free
- Cons: doubles the container count, needs per-runtime mesh setup, significant operational knowledge
- Rejected for v1: revisit if cross-host groups become a requirement

### Hardcoded addresses written by the operator
- Pros: nothing to build
- Cons: this is the manual glue the tool exists to remove
- Rejected

## Consequences
- Internal members need no host ports at all (see ADR-002).
- Once apps read `SVC_*` names they are a public contract under Hyrum's Law; changes require a new injection version and an explicit migration.
- ECS Service Connect requires a Cloud Map namespace and the `servicediscovery` permissions in the AWS policy; all members of an ECS group must be in the same cluster and VPC. Service Connect supports bridge and `awsvpc` network modes on the EC2 launch type, not `host` mode.
