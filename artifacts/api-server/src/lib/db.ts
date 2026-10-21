import { db } from "@workspace/db";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = Tx | typeof db;

/** True for a Postgres unique-constraint violation, whether or not Drizzle wrapped it. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = unwrap(err);
  if (!e || e.code !== "23505") return false;
  return constraint ? e.constraint === constraint : true;
}

function unwrap(err: unknown): { code?: string; constraint?: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; cause?: unknown };
  if (e.code) return e;
  if (e.cause && typeof e.cause === "object") return unwrap(e.cause);
  return null;
}

export { db };
