---
name: Monorepo TypeScript setup
description: tsconfig/dependency rules that made the pnpm monorepo (lib/* + artifacts/*) typecheck cleanly.
---
- A shared lib referenced from an app tsconfig (`references`) must have `composite: true`, `declaration`/`declarationMap`, and `emitDeclarationOnly`; otherwise `tsc --build` fails with "referenced project must have composite".
- An app that imports `zod` directly needs its own `zod: catalog:` dependency even if a lib already depends on it (pnpm strict node_modules).
- A web lib that uses `import.meta.env` needs its own `env.d.ts` (vite/client types) and `dom.iterable` in lib when it iterates DOM collections.
**Why:** these failures show up only in `pnpm run typecheck` / `tsc --build`, not in the Vite dev server, so the preview looks fine while the build is broken.
**How to apply:** when adding a lib or a new cross-package import.
