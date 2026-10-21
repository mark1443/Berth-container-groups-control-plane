# ADR-002: Entry port given by the operator, everything else allocated and recorded

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
The operator wants to "just give a port" and never edit host↔container port mappings by hand. A group typically has one public-facing member and several members that only talk to each other. Port collisions on a shared host are the common failure today. The operator's ECS services use the EC2 launch type with bridge networking, where host ports are chosen in the task definition; `awsvpc` task definitions do not allow choosing a host port (host port equals container port).

## Decision
A group has exactly one `ENTRY` member that receives the operator-supplied entry port. Members default to `INTERNAL` and get no host port at all; they are reached over the group network by name. Members marked `EXPOSED` get a host port allocated from a per-host range (default 20000–29999). Every allocation is a row in `port_allocations` with a partial unique index on `(providerId, hostPort, protocol) WHERE state <> 'RELEASED'`; a claim is a single INSERT and the index decides collisions. Observed ports of unmanaged containers are treated as taken when allocating. On runtimes where `canChooseHostPort` is false, the allocator validates and records instead of choosing.

## Alternatives Considered

### One reverse proxy on the given port, routing to members
- Pros: a single public port for the whole group, path or host based routing, TLS termination in one place
- Cons: adds a proxy container per group that Berth must also manage; changes how apps see client IPs and headers; the operator explicitly chose bookkeeping over a proxy in the clarification round
- Rejected: not what was asked for; can be added later as an optional group feature

### Operator chooses every host port manually, Berth only validates
- Pros: trivial to implement
- Cons: this is the current pain; collisions still happen at the moment of choice
- Rejected: fails the objective

### Check-then-insert allocation in application code
- Pros: readable
- Cons: two concurrent applies both read "free" and both proceed; the race is exactly the collision we are trying to prevent
- Rejected: the unique index is the correct mechanism

## Consequences
- Most members need no host port, which reduces the host's exposed surface compared with today.
- The allocator is a small pure core with one SQL guarantee, easy to test under concurrency.
- Groups on `awsvpc` task definitions are more constrained; the UI must explain why a port field is read-only there.
- Released allocations are kept for audit; cleanup is a retention job, not a delete on release.
