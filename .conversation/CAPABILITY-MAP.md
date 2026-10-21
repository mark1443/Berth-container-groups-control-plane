# Capability Map: Berth (working title)

A self-hosted control plane that discovers containers running on your Docker hosts (EC2 / VPS) and ECS clusters, lets you bundle them into **groups**, takes one port per group and does the port-mapping bookkeeping, manages environment variables and secrets, and wires the apps in a group together.

Status: **Accepted** 2026-10-21. Revised after the clarification round (ECS added as a second runtime; port model changed to allocation/bookkeeping). ECS runtime is the EC2 launch type.

| Module id | Responsibility | Depends on |
|---|---|---|
| `providers` | Register runtimes and reach them: Docker hosts over SSH or TLS, ECS clusters through the AWS SDK. Holds encrypted credentials. One `Provider` interface, two adapters (`docker`, `ecs`). | — |
| `discovery` | Keep a live inventory of **workloads** (Docker containers, ECS tasks) per provider: name, image, status, ports, networks, health. Detect drift against desired state. | `providers` |
| `groups` | Named sets of workloads on one provider. You give the group's **entry port**; the tool allocates and tracks every host↔container port mapping, collision-free per host. | `discovery` |
| `config` | Environment variables and secrets per group and per member. Manual values encrypted at rest; AWS SSM Parameter Store and Secrets Manager as referenced sources. | `groups` |
| `integration` | Per-group private network (Docker user-defined network / ECS Service Connect namespace), service discovery by member name, injected `SVC_*` env vars, health checks. | `groups`, `config` |
| `apply` | Turn desired state (group + allocations + config + wiring) into provider operations: recreate containers, register task-definition revisions, update services. Idempotent, logged, resumable. | `integration` |

Build order: `providers` → `discovery` → `groups` → `config` → `integration` → `apply`

Notes

- The web console is not a module; it grows a screen per module in the same order.
- `apply` is listed last because it is the only module that mutates the runtime. Everything before it is read-only against your hosts, which keeps the first four modules safe to ship and test against real infrastructure.
- A group lives on **one** provider in v1. Cross-provider groups (a container on EC2 talking to a Fargate task) are out of scope; see Open Questions in `SPEC.md`.
- Contracts between modules live in the provider module's spec, following `api-and-interface-design`. The public HTTP API is specified in `docs/architecture.md`.
