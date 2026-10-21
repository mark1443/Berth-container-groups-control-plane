import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { providersTable } from "./providers";
import { workloadsTable } from "./workloads";

export const GROUP_STATUSES = [
  "DRAFT",
  "APPLYING",
  "APPLIED",
  "DRIFTED",
  "FAILED",
] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

export const MEMBER_ROLES = ["ENTRY", "INTERNAL", "EXPOSED"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PROTOCOLS = ["TCP", "UDP"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const ALLOCATION_STATES = ["RESERVED", "APPLIED", "RELEASED"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

export interface HealthCheckRecord {
  kind: "TCP" | "HTTP";
  path?: string;
  timeoutSeconds?: number;
}

export const groupsTable = pgTable(
  "groups",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerId: text("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    entryPort: integer("entry_port").notNull(),
    protocol: text("protocol").$type<Protocol>().notNull().default("TCP"),
    status: text("status").$type<GroupStatus>().notNull().default("DRAFT"),
    networkRef: text("network_ref"),
    injectionPrefix: text("injection_prefix").notNull().default("SVC"),
    injectionVersion: integer("injection_version").notNull().default(1),
    driftReasons: jsonb("drift_reasons").$type<string[]>().notNull().default([]),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("groups_provider_name_idx").on(t.providerId, t.name)],
);

export const groupMembersTable = pgTable(
  "group_members",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    groupId: text("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    workloadId: text("workload_id")
      .notNull()
      .references(() => workloadsTable.id, { onDelete: "restrict" }),
    serviceName: text("service_name").notNull(),
    role: text("role").$type<MemberRole>().notNull().default("INTERNAL"),
    containerPort: integer("container_port").notNull(),
    healthCheck: jsonb("health_check").$type<HealthCheckRecord | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A workload belongs to at most one group.
    uniqueIndex("group_members_workload_idx").on(t.workloadId),
    uniqueIndex("group_members_service_name_idx").on(t.groupId, t.serviceName),
  ],
);

/**
 * Host-port ledger (ADR-002). A claim is a single INSERT; the partial
 * unique index makes two live claims for the same (provider, port,
 * protocol) impossible, whatever the concurrency. Released rows stay for
 * audit.
 */
export const portAllocationsTable = pgTable(
  "port_allocations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    providerId: text("provider_id")
      .notNull()
      .references(() => providersTable.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => groupMembersTable.id, {
      onDelete: "set null",
    }),
    hostPort: integer("host_port").notNull(),
    protocol: text("protocol").$type<Protocol>().notNull().default("TCP"),
    state: text("state").$type<AllocationState>().notNull().default("RESERVED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("port_allocations_live_idx")
      .on(t.providerId, t.hostPort, t.protocol)
      .where(sql`${t.state} <> 'RELEASED'`),
    index("port_allocations_group_idx").on(t.groupId),
  ],
);

export type GroupRow = typeof groupsTable.$inferSelect;
export type InsertGroup = typeof groupsTable.$inferInsert;
export type GroupMemberRow = typeof groupMembersTable.$inferSelect;
export type InsertGroupMember = typeof groupMembersTable.$inferInsert;
export type PortAllocationRow = typeof portAllocationsTable.$inferSelect;
export type InsertPortAllocation = typeof portAllocationsTable.$inferInsert;
