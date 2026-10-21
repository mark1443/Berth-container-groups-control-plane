---
name: Postgres transaction rules
description: How to do uniqueness-guarded claims inside Drizzle transactions without aborting them.
---
- Rule: inside a transaction, a unique-violation error aborts the whole transaction ("current transaction is aborted"); catching it in JS does not help. For claim-style inserts (port ledger, idempotency keys) use `INSERT … ON CONFLICT DO NOTHING RETURNING` and treat an empty result as the conflict.
- Keep the conflict-to-error mapping outside the transaction scope only when the transaction has nothing else to do; otherwise do the ON CONFLICT dance and throw a domain error after reading the result.
**Why:** the port allocator's first version threw on unique violation and every later statement in the same transaction failed with a confusing error.
**How to apply:** any insert that relies on a unique/partial-unique index for concurrency control.
