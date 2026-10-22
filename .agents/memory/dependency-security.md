---
name: Dependency security exceptions
description: Rationale for the glob replacement and typography parser override.
---

Avoid reintroducing the fast-glob → micromatch → braces dependency chain for preview discovery while braces has no fixed release for GHSA-vfj7-8cjw-p6xm.

**Why:** The latest braces release available on 2026-10-22 was still vulnerable. Upgrading its parents could not eliminate the finding; tinyglobby supports the required discovery patterns without that dependency.

**How to apply:** Check the current advisory and package releases before switching glob libraries. Keep recursive TSX discovery and underscore-file/directory exclusions covered by regression tests.

Keep the typography selector-parser override scoped to that parent until upstream removes its exact vulnerable pin.

**Why:** The latest typography release available on 2026-10-22 pinned an affected parser, requiring a major parser update even though no application API change was needed.

**How to apply:** Revisit the override when typography upgrades its dependency; verify CSS builds before removing it or widening its scope.
