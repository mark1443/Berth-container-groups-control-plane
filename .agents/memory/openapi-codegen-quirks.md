---
name: OpenAPI codegen quirks
description: Sharp edges of the orval-based codegen pipeline (lib/api-spec -> lib/api-zod, lib/api-client-react) found while building Berth.
---
- Rule: edit lib/api-spec/openapi.yaml first, run the api-spec codegen, then typecheck. The generated Zod schemas are the server's validation; hand-written schemas drift.
- Quote YAML strings that contain ": " (descriptions/examples with colons) or the parser breaks the document silently in odd places.
- Orval emits `zod.coerce.boolean()` for boolean query params; `"false"` coerces to `true`. Parse boolean query flags by hand in the route (string compare) instead of trusting the generated schema.
- A generic helper that validates with a schema must be typed `<S extends ZodType>(schema: S) => z.output<S>`; `ZodType<T>` infers `unknown`.
- A PATCH body that deletes with `null` values does not survive codegen cleanly (nullable map values become awkward types); use an explicit `{ set: [...], remove: [...] }` shape.
**Why:** each of these cost a debugging loop; none is visible from the generated output.
**How to apply:** any time the API contract changes or a query flag misbehaves.
