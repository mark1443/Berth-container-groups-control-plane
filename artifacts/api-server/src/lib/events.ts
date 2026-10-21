import { activityEventsTable, db, type ActivityEventKind } from "@workspace/db";
import { logger } from "./logger";

export interface EventInput {
  kind: ActivityEventKind;
  message: string;
  actor?: string | null;
  providerId?: string | null;
  groupId?: string | null;
  operationId?: string | null;
  /** Ids and config keys only; never values. */
  details?: Record<string, unknown>;
}

type Executor = Pick<typeof db, "insert">;

/**
 * Append to the audit trail. Pass the transaction when the event must
 * disappear with a rolled-back write; otherwise it is best-effort and never
 * fails the request.
 */
export async function recordEvent(input: EventInput, tx: Executor = db): Promise<void> {
  try {
    await tx.insert(activityEventsTable).values({
      kind: input.kind,
      message: input.message,
      actor: input.actor ?? null,
      providerId: input.providerId ?? null,
      groupId: input.groupId ?? null,
      operationId: input.operationId ?? null,
      details: input.details ?? {},
    });
  } catch (err) {
    if (tx !== db) throw err;
    logger.error({ err, kind: input.kind }, "Failed to record activity event");
  }
}
