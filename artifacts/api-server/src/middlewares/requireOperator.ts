import { db, operatorsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthenticatedError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { logger } from "../lib/logger";

const CACHE_TTL_MS = 30_000;
const allowed = new Map<string, number>();

function envOperators(): Set<string> {
  return new Set(
    (process.env.BERTH_OPERATORS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function isOperator(user: Express.User): Promise<boolean> {
  const cached = allowed.get(user.id);
  if (cached && cached > Date.now()) return true;

  const listed = envOperators();
  const email = user.email?.toLowerCase() ?? "";
  const inEnv = listed.has(user.id.toLowerCase()) || (email !== "" && listed.has(email));

  const [row] = await db
    .select({ userId: operatorsTable.userId })
    .from(operatorsTable)
    .where(eq(operatorsTable.userId, user.id));

  let ok = Boolean(row) || inEnv;

  if (!ok && listed.size === 0) {
    // First account to sign in claims the instance (ADR-007).
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorsTable);
    if (count === 0) {
      await db
        .insert(operatorsTable)
        .values({ userId: user.id, email: user.email ?? null, addedBy: "first-sign-in" })
        .onConflictDoNothing();
      await recordEvent({
        kind: "OPERATOR_ADDED",
        message: `${user.email ?? user.id} claimed this Berth instance as its first operator`,
        actor: user.id,
        details: { userId: user.id },
      });
      logger.info({ userId: user.id }, "First operator claimed the instance");
      ok = true;
    }
  }

  if (ok && !row) {
    await db
      .insert(operatorsTable)
      .values({ userId: user.id, email: user.email ?? null, addedBy: inEnv ? "env" : "first-sign-in" })
      .onConflictDoNothing();
  }
  if (ok) allowed.set(user.id, Date.now() + CACHE_TTL_MS);
  return ok;
}

/** 401 when not signed in, 403 when signed in but not an operator. */
export async function requireOperator(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.isAuthenticated()) throw new UnauthenticatedError();
    if (!(await isOperator(req.user))) throw new ForbiddenError();
    next();
  } catch (err) {
    next(err);
  }
}

export function actorOf(req: Request): string | null {
  return req.user?.id ?? null;
}
