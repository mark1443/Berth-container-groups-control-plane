import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { groupsTable } from "./groups";

export const OPERATION_KINDS = ["APPLY", "ROLLBACK", "RELEASE"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

export const STEP_KINDS = [
  "ENSURE_NETWORK",
  "APPLY_MEMBER",
  "OPEN_INGRESS",
  "RELEASE_PORT",
  "RELEASE_NETWORK",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_STATES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "UNKNOWN",
  "SKIPPED",
  "ROLLED_BACK",
] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface OperationStepRecord {
  index: number;
  kind: StepKind;
  state: StepState;
  memberId: string | null;
  serviceName: string | null;
  summary: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/**
 * One row per apply (ADR-006). The unique (group, idempotencyKey) index is
 * what makes a retried POST safe: the second INSERT fails, the first row
 * is replayed. UNKNOWN is terminal and never auto-retried.
 */
export const operationsTable = pgTable(
  "operations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    groupId: text("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    kind: text("kind").$type<OperationKind>().notNull().default("APPLY"),
    state: text("state").$type<OperationState>().notNull().default("PENDING"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    reason: text("reason"),
    steps: jsonb("steps").$type<OperationStepRecord[]>().notNull().default([]),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("operations_group_idempotency_idx").on(t.groupId, t.idempotencyKey),
    index("operations_group_created_idx").on(t.groupId, t.createdAt),
    index("operations_state_idx").on(t.state),
  ],
);

export type OperationRow = typeof operationsTable.$inferSelect;
export type InsertOperation = typeof operationsTable.$inferInsert;
