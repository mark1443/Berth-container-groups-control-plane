import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const CONFIG_SCOPES = ["GROUP", "MEMBER"] as const;
export type ConfigScope = (typeof CONFIG_SCOPES)[number];

export const CONFIG_SOURCES = [
  "MANUAL",
  "AWS_SSM",
  "AWS_SECRETS_MANAGER",
] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

/**
 * Env vars and secrets (ADR-003). Non-secret MANUAL values live in
 * `valuePlain`; secret MANUAL values are sealed into `valueCiphertext`;
 * AWS-backed entries store only the reference and are resolved at apply
 * time by the provider.
 */
export const configEntriesTable = pgTable(
  "config_entries",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scopeType: text("scope_type").$type<ConfigScope>().notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    isSecret: boolean("is_secret").notNull().default(false),
    source: text("source").$type<ConfigSource>().notNull().default("MANUAL"),
    valuePlain: text("value_plain"),
    valueCiphertext: text("value_ciphertext"),
    keyVersion: integer("key_version").notNull().default(1),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("config_entries_scope_key_idx").on(t.scopeType, t.scopeId, t.key),
  ],
);

export type ConfigEntryRow = typeof configEntriesTable.$inferSelect;
export type InsertConfigEntry = typeof configEntriesTable.$inferInsert;
