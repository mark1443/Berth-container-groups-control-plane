# ADR-007: Replit Auth (OIDC) with an operator allow-list

Status: Accepted · Date: 2026-10-21 · Supersedes the single-admin password design in `docs/architecture.md` §9 and Task 3 of `tasks/plan.md`.

## Context

The spec called for one admin account with an Argon2id password hash, a session cookie and CSRF tokens, with OIDC as a v2 candidate. Berth now runs as a Replit deployment, where Replit Auth (OpenID Connect with PKCE) is available with no secret to provision and no password to store. A control plane that holds SSH keys and AWS credentials should not also be in the business of password resets.

## Decision

- Sign-in is Replit Auth. The API keeps a server-side session (Postgres `sessions` table, HTTP-only `sid` cookie, `SameSite=Lax`, 7-day TTL, refresh-token renewal). No password is stored anywhere in Berth.
- Being signed in is not enough. Every Berth route sits behind `requireOperator`, which answers `401 UNAUTHENTICATED` when there is no session and `403 FORBIDDEN` when the account is not an operator.
- Operators come from two places:
  1. `BERTH_OPERATORS` — a comma-separated list of Replit user ids or e-mail addresses (checked case-insensitively).
  2. The `operators` table. When `BERTH_OPERATORS` is empty and the table is empty, **the first account to sign in claims the instance** and is recorded with `addedBy = first-sign-in`, together with an `OPERATOR_ADDED` activity event.
- Operator checks are cached in-process for 30 seconds, so revoking access takes effect within half a minute without a restart.
- Mutations rely on the `SameSite=Lax` cookie plus JSON bodies (no form posts); a separate CSRF token is not issued. `cors({ credentials: true, origin: true })` is in place for the proxied development preview.

## Consequences

- Positive: no password lifecycle, no secret to rotate, MFA and account recovery are Replit's problem, and the audit trail records real user ids.
- Positive: a fresh deployment is usable immediately (first sign-in claims it) and can be locked down explicitly by setting `BERTH_OPERATORS` before anyone else signs in.
- Negative: Berth cannot be used by people without a Replit account. Acceptable for v1, whose users are the operators of the hosting account.
- Negative: there is no UI for adding operators yet; it is `BERTH_OPERATORS` or a row in `operators`. A settings page is a candidate for Phase 6.
- Testing: integration tests insert a session row and an `operators` row for a throwaway user (`scripts/smoke.sh`), never a real credential.
