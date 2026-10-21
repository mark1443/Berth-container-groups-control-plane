# ADR-003: Encrypted config in Postgres, AWS SSM and Secrets Manager as referenced sources

## Status
Accepted (2026-10-21)

## Date
2026-10-21

## Context
Environment variables and secrets are currently scattered across env files on hosts and task definitions in AWS. The operator wants one place to manage them for Docker hosts and ECS alike. ECS supports secrets natively (`secrets[].valueFrom` with SSM or Secrets Manager ARNs); Docker containers only receive plain environment variables.

## Decision
Store config entries per group and per member in Postgres. `MANUAL` values are encrypted with AES-256-GCM using per-row data keys wrapped by a master key held as a deployment secret. `AWS_SSM` and `AWS_SECRETS_MANAGER` entries store only the reference. On ECS the reference is passed through natively so the plaintext never transits Berth. On Docker hosts the adapter resolves the reference at apply time and injects the value into the container environment. Secret values are never returned by the API or written to logs; redaction is enforced in the logger.

## Alternatives Considered

### HashiCorp Vault (or another dedicated secret store)
- Pros: strong audit, dynamic secrets, leasing
- Cons: a second system to run and secure; the operator is already on AWS, which provides SSM and Secrets Manager
- Rejected: operational weight for a small team; AWS stores cover the need

### Env files managed on each host
- Pros: no encryption in Berth
- Cons: sprawl across hosts, no audit, nothing comparable for ECS
- Rejected: reproduces the current problem

### Plaintext in Postgres with database-level encryption only
- Pros: simplest code
- Cons: any read access to the database or a backup exposes every secret
- Rejected: unacceptable blast radius

## Consequences
- Key rotation re-wraps data keys without re-encrypting values.
- Docker-host injection makes values visible to anyone with `docker inspect` on that host; this is documented in the UI as a gotcha and is the reason ECS native secrets are preferred when available.
- The least-privilege AWS policy must include `ssm:GetParameter(s)` and `secretsmanager:GetSecretValue` for Docker-host resolution, and `iam:PassRole` for ECS task execution roles that read secrets.
