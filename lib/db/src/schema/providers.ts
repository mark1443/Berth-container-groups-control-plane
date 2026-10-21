import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const PROVIDER_KINDS = ["DOCKER_HOST", "ECS_CLUSTER"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Which adapter backs the provider. `fake` is the in-memory runtime used by the demo host and tests. */
export const PROVIDER_RUNTIMES = ["docker", "ecs", "fake"] as const;
export type ProviderRuntime = (typeof PROVIDER_RUNTIMES)[number];

export const PROVIDER_STATUSES = ["ONLINE", "OFFLINE", "DEGRADED"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const CREDENTIAL_KINDS = [
  "SSH_KEY",
  "TLS_BUNDLE",
  "AWS_KEYS",
  "AWS_ROLE",
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export interface ProviderSettingsRecord {
  transport?: "SSH" | "TCP_TLS";
  host?: string;
  port?: number;
  sshUser?: string;
  region?: string;
  clusterArn?: string;
  vpcId?: string;
  portRangeStart: number;
  portRangeEnd: number;
}

export const providersTable = pgTable(
  "providers",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").$type<ProviderKind>().notNull(),
    runtime: text("runtime").$type<ProviderRuntime>().notNull().default("docker"),
    name: text("name").notNull(),
    status: text("status").$type<ProviderStatus>().notNull().default("OFFLINE"),
    settings: jsonb("settings").$type<ProviderSettingsRecord>().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("providers_name_idx").on(t.name)],
);

/**
 * One credential per provider. `ciphertext` holds the JSON credential
 * material sealed with AES-256-GCM (base64 of iv || tag || data).
 * The plaintext never leaves the process that needs it.
 */
export const credentialsTable = pgTable("credentials", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  providerId: text("provider_id")
    .notNull()
    .unique()
    .references(() => providersTable.id, { onDelete: "cascade" }),
  kind: text("kind").$type<CredentialKind>().notNull(),
  ciphertext: text("ciphertext").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  publicKey: text("public_key"),
  fingerprint: text("fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProviderRow = typeof providersTable.$inferSelect;
export type InsertProvider = typeof providersTable.$inferInsert;
export type CredentialRow = typeof credentialsTable.$inferSelect;
