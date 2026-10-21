import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { providersTable } from "./providers";

export const WORKLOAD_STATUSES = [
  "RUNNING",
  "STOPPED",
  "MISSING",
  "UNKNOWN",
] as const;
export type WorkloadStatus = (typeof WORKLOAD_STATUSES)[number];

export interface PortBindingRecord {
  containerPort: number;
  hostPort: number | null;
  protocol: "TCP" | "UDP";
  hostIp?: string | null;
}

export interface MountRecord {
  destination: string;
  source: string | null;
  type: string;
  anonymous: boolean;
}

/** Facts only needed on the detail page; kept out of the list query. */
export interface WorkloadDetailRecord {
  command: string[];
  mounts: MountRecord[];
  restartPolicy: string | null;
  health: string | null;
  runtime: Record<string, unknown>;
}

/**
 * Observed state. Berth never edits a workload directly; discovery
 * upserts rows keyed by (provider, externalId) and marks the ones that
 * disappeared as MISSING instead of deleting them, so group members keep
 * their history.
 */
export const workloadsTable = pgTable(
  "workloads",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerId: text("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    image: text("image").notNull(),
    status: text("status").$type<WorkloadStatus>().notNull().default("UNKNOWN"),
    ports: jsonb("ports").$type<PortBindingRecord[]>().notNull().default([]),
    networks: jsonb("networks").$type<string[]>().notNull().default([]),
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    envHash: text("env_hash"),
    detail: jsonb("detail")
      .$type<WorkloadDetailRecord>()
      .notNull()
      .default({
        command: [],
        mounts: [],
        restartPolicy: null,
        health: null,
        runtime: {},
      }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workloads_provider_external_idx").on(t.providerId, t.externalId),
    index("workloads_status_idx").on(t.status),
  ],
);

export type WorkloadRow = typeof workloadsTable.$inferSelect;
export type InsertWorkload = typeof workloadsTable.$inferInsert;
