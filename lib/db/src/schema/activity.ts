import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const ACTIVITY_EVENT_KINDS = [
  "PROVIDER_REGISTERED",
  "PROVIDER_UPDATED",
  "PROVIDER_REMOVED",
  "PROVIDER_STATUS_CHANGED",
  "DISCOVERY_COMPLETED",
  "WORKLOAD_MISSING",
  "GROUP_CREATED",
  "GROUP_UPDATED",
  "GROUP_DELETED",
  "MEMBER_ADDED",
  "MEMBER_UPDATED",
  "MEMBER_REMOVED",
  "PORT_RESERVED",
  "PORT_RELEASED",
  "CONFIG_CHANGED",
  "OPERATION_CREATED",
  "OPERATION_FINISHED",
  "DRIFT_DETECTED",
  "OPERATOR_ADDED",
] as const;
export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

/**
 * Append-only audit trail. `details` carries ids and config keys, never
 * values. Rows are not foreign-keyed so history survives deletes.
 */
export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").$type<ActivityEventKind>().notNull(),
    message: text("message").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor"),
    providerId: text("provider_id"),
    groupId: text("group_id"),
    operationId: text("operation_id"),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index("activity_events_at_idx").on(t.at),
    index("activity_events_group_idx").on(t.groupId),
  ],
);

/**
 * Operators allowed to use this Berth instance. The first account to sign
 * in claims the instance; everyone else is FORBIDDEN until added here or
 * listed in BERTH_OPERATORS.
 */
export const operatorsTable = pgTable("operators", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityEventRow = typeof activityEventsTable.$inferSelect;
export type InsertActivityEvent = typeof activityEventsTable.$inferInsert;
export type OperatorRow = typeof operatorsTable.$inferSelect;
