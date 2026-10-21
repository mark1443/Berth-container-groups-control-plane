import type { ConfigEntry, ConfigPatch, RenderedEnv, RenderedEnvEntry } from "@workspace/api-zod";
import { configEntriesTable, type ConfigEntryRow, type ConfigScope } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { open, seal } from "../lib/crypto";
import { db, type Executor } from "../lib/db";
import { NotFoundError, ValidationError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { loadGroupBundle, type GroupBundle } from "./groups";
import { refreshDrift } from "./plan";

const RESERVED_PREFIXES = ["BERTH_", "SVC_"];

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function getEntries(scopeType: ConfigScope, scopeId: string, tx: Executor = db): Promise<ConfigEntryRow[]> {
  return tx
    .select()
    .from(configEntriesTable)
    .where(and(eq(configEntriesTable.scopeType, scopeType), eq(configEntriesTable.scopeId, scopeId)))
    .orderBy(asc(configEntriesTable.key));
}

export async function getGroupConfig(groupId: string): Promise<ConfigEntry[]> {
  await loadGroupBundle(groupId);
  return (await getEntries("GROUP", groupId)).map(serializeEntry);
}

export async function getMemberConfig(groupId: string, memberId: string): Promise<ConfigEntry[]> {
  requireMember(await loadGroupBundle(groupId), memberId);
  return (await getEntries("MEMBER", memberId)).map(serializeEntry);
}

export async function patchGroupConfig(groupId: string, patch: ConfigPatch, actor: string | null): Promise<ConfigEntry[]> {
  const bundle = await loadGroupBundle(groupId);
  await applyPatch("GROUP", groupId, patch, actor, bundle);
  return (await getEntries("GROUP", groupId)).map(serializeEntry);
}

export async function patchMemberConfig(
  groupId: string,
  memberId: string,
  patch: ConfigPatch,
  actor: string | null,
): Promise<ConfigEntry[]> {
  const bundle = await loadGroupBundle(groupId);
  requireMember(bundle, memberId);
  await applyPatch("MEMBER", memberId, patch, actor, bundle);
  return (await getEntries("MEMBER", memberId)).map(serializeEntry);
}

async function applyPatch(
  scopeType: ConfigScope,
  scopeId: string,
  patch: ConfigPatch,
  actor: string | null,
  bundle: GroupBundle,
): Promise<void> {
  const set = patch.set ?? [];
  const remove = patch.remove ?? [];
  for (const e of set) {
    if (RESERVED_PREFIXES.some((p) => e.key.startsWith(p))) {
      throw new ValidationError(`${e.key} is reserved; Berth injects ${RESERVED_PREFIXES.join(" and ")} variables itself`, {
        key: e.key,
      });
    }
    const source = e.source ?? "MANUAL";
    if (source === "MANUAL" && e.value === undefined) {
      throw new ValidationError(`${e.key} needs a value`, { key: e.key });
    }
    if (source !== "MANUAL" && !e.sourceRef) {
      throw new ValidationError(`${e.key} needs a sourceRef for ${source}`, { key: e.key, source });
    }
  }
  if (set.length === 0 && remove.length === 0) return;

  await db.transaction(async (tx) => {
    for (const e of set) {
      const source = e.source ?? "MANUAL";
      const isSecret = e.isSecret ?? source === "AWS_SECRETS_MANAGER";
      const manual = source === "MANUAL";
      const values = {
        isSecret,
        source,
        valuePlain: manual && !isSecret ? e.value! : null,
        valueCiphertext: manual && isSecret ? seal(e.value!, `${scopeType}:${scopeId}:${e.key}`) : null,
        sourceRef: manual ? null : e.sourceRef!,
      };
      await tx
        .insert(configEntriesTable)
        .values({ scopeType, scopeId, key: e.key, ...values })
        .onConflictDoUpdate({
          target: [configEntriesTable.scopeType, configEntriesTable.scopeId, configEntriesTable.key],
          set: values,
        });
    }
    if (remove.length > 0) {
      await tx
        .delete(configEntriesTable)
        .where(
          and(
            eq(configEntriesTable.scopeType, scopeType),
            eq(configEntriesTable.scopeId, scopeId),
            inArray(configEntriesTable.key, remove),
          ),
        );
    }
    const scopeLabel =
      scopeType === "GROUP"
        ? `group ${bundle.group.name}`
        : `member ${bundle.members.find((m) => m.member.id === scopeId)?.member.serviceName ?? scopeId}`;
    await recordEvent(
      {
        kind: "CONFIG_CHANGED",
        message: `Config changed on ${scopeLabel}: ${[...set.map((s) => `+${s.key}`), ...remove.map((r) => `-${r}`)].join(" ")}`,
        actor,
        providerId: bundle.provider.id,
        groupId: bundle.group.id,
        details: { scopeType, scopeId, set: set.map((s) => s.key), removed: remove },
      },
      tx,
    );
  });
  await refreshDrift(bundle.group.id);
}

export function serializeEntry(row: ConfigEntryRow): ConfigEntry {
  return {
    key: row.key,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    isSecret: row.isSecret,
    source: row.source,
    valuePresent: row.valuePlain !== null || row.valueCiphertext !== null || row.sourceRef !== null,
    value: row.isSecret ? null : row.valuePlain,
    sourceRef: row.sourceRef,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Rendering (ADR-004): group entries < member entries, plus injected wiring.
// ---------------------------------------------------------------------------

export interface ResolvedEnv {
  /** Everything with a concrete value, secrets decrypted. For the runtime only. */
  env: Record<string, string>;
  /** AWS-backed entries, passed to the runtime by reference. */
  secretRefs: Record<string, string>;
  /** Display form: secrets masked. */
  entries: RenderedEnvEntry[];
}

export async function resolveMemberEnv(bundle: GroupBundle, memberId: string, tx: Executor = db): Promise<ResolvedEnv> {
  const member = requireMember(bundle, memberId);
  const [groupEntries, memberEntries] = await Promise.all([
    getEntries("GROUP", bundle.group.id, tx),
    getEntries("MEMBER", memberId, tx),
  ]);

  const merged = new Map<string, { row: ConfigEntryRow; origin: "GROUP" | "MEMBER" }>();
  for (const row of groupEntries) merged.set(row.key, { row, origin: "GROUP" });
  for (const row of memberEntries) merged.set(row.key, { row, origin: "MEMBER" });

  const env: Record<string, string> = {};
  const secretRefs: Record<string, string> = {};
  const entries: RenderedEnvEntry[] = [];
  for (const { row, origin } of merged.values()) {
    let concrete: string | null = null;
    if (row.source === "MANUAL") {
      concrete = row.isSecret
        ? open(row.valueCiphertext ?? "", `${row.scopeType}:${row.scopeId}:${row.key}`)
        : (row.valuePlain ?? "");
      env[row.key] = concrete;
    } else if (row.sourceRef) {
      secretRefs[row.key] = row.sourceRef;
    }
    entries.push({
      key: row.key,
      value: row.isSecret ? null : concrete,
      origin,
      isSecret: row.isSecret,
      source: row.source,
      sourceRef: row.sourceRef,
    });
  }

  for (const [key, value] of Object.entries(injectedEnv(bundle, member.member.id))) {
    env[key] = value;
    entries.push({ key, value, origin: "INJECTED", isSecret: false, source: null, sourceRef: null });
  }
  entries.sort((a, b) => originRank(a.origin) - originRank(b.origin) || a.key.localeCompare(b.key));
  return { env, secretRefs, entries };
}

export async function getMemberEnv(groupId: string, memberId: string): Promise<RenderedEnv> {
  const bundle = await loadGroupBundle(groupId);
  const member = requireMember(bundle, memberId);
  const resolved = await resolveMemberEnv(bundle, memberId);
  return { groupId, memberId, serviceName: member.member.serviceName, entries: resolved.entries };
}

/** The wiring every member receives: who it is, and where every peer is. */
export function injectedEnv(bundle: GroupBundle, memberId: string): Record<string, string> {
  const self = requireMember(bundle, memberId);
  const prefix = bundle.group.injectionPrefix;
  const out: Record<string, string> = {
    BERTH_GROUP: bundle.group.name,
    BERTH_SERVICE: self.member.serviceName,
    BERTH_ROLE: self.member.role,
    BERTH_ENTRY_PORT: String(bundle.group.entryPort),
    BERTH_INJECTION_VERSION: String(bundle.group.injectionVersion),
  };
  for (const { member } of bundle.members) {
    const name = envName(member.serviceName);
    out[`${prefix}_${name}_HOST`] = member.serviceName;
    out[`${prefix}_${name}_PORT`] = String(member.containerPort);
    out[`${prefix}_${name}_ADDR`] = `${member.serviceName}:${member.containerPort}`;
  }
  return out;
}

export function envName(serviceName: string): string {
  return serviceName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function originRank(origin: RenderedEnvEntry["origin"]): number {
  return origin === "GROUP" ? 0 : origin === "MEMBER" ? 1 : 2;
}

function requireMember(bundle: GroupBundle, memberId: string) {
  const found = bundle.members.find((m) => m.member.id === memberId);
  if (!found) throw new NotFoundError("Group member", memberId);
  return found;
}
