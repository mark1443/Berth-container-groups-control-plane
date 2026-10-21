import type { z, ZodType } from "zod";
import { ValidationError } from "./errors";

/** Validate at the boundary only; services receive typed input. */
export function parseWith<S extends ZodType>(schema: S, input: unknown, where = "body"): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw ValidationError.fromZod(result.error, where);
  return result.data as z.output<S>;
}
