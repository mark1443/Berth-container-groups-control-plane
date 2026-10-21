---
name: Testing without vitest
description: How unit and end-to-end tests run in this monorepo without adding a test framework.
---
- Unit tests: `node --test` over an esbuild bundle. Sources use extension-less relative imports, which Node ESM cannot resolve, so `test/run.mjs` bundles `test/*.test.ts` first. The bundle must be written inside the package (e.g. `.test-dist/`, gitignored), not /tmp, or externals like zod cannot be resolved.
- Keep `test/` outside the tsconfig `include` (rootDir is src).
- End-to-end: `scripts/smoke.sh` inserts a session row plus an `operators` row for a throwaway user and deletes both on exit. The real operator row (first sign-in claim) must never be touched. Bash functions that build curl output do not compose well under `&`; the parallel race test calls curl directly and reads one status file per request.
- Tests must not assume the first free port of a range is allocated: the fake runtime keeps ports published by earlier applies, exactly like a real host.
**Why:** the template ships no vitest/supertest; the built-in runner avoided a dependency and the smoke run proved the API without a browser.
**How to apply:** when adding tests or debugging a smoke failure.
