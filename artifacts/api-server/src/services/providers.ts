import type {
  ConnectivityReport,
  CredentialKind,
  PortUsage,
  Provider as ApiProvider,
  ProviderInput,
  ProviderUpdate,
} from "@workspace/api-zod";
import {
  credentialsTable,
  groupsTable,
  portAllocationsTable,
  providersTable,
  workloadsTable,
  type CredentialRow,
  type ProviderRow,
  type ProviderSettingsRecord,
  type ProviderStatus,
} from "@workspace/db";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { open, seal, sha256 } from "../lib/crypto";
import { db, isUniqueViolation, type Executor } from "../lib/db";
import { ConflictError, NotFoundError, ValidationError, sanitize } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { paginate, type PageRequest, type Paginated } from "../lib/pagination";
import { DEFAULT_PORT_RANGE, type CredentialMaterial } from "../providers/provider";
import { capabilitiesFor, contextFor, providerFor } from "../providers/registry";

type CredentialInput = ProviderInput["credential"];

const DOCKER_CREDENTIALS: CredentialKind[] = ["SSH_KEY", "TLS_BUNDLE"];
const ECS_CREDENTIALS: CredentialKind[] = ["AWS_KEYS", "AWS_ROLE"];

export async function listProviders(
  page: PageRequest,
  filter: { kind?: ProviderRow["kind"] } = {},
): Promise<Paginated<ApiProvider>> {
  const where = filter.kind ? eq(providersTable.kind, filter.kind) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(providersTable)
      .where(where)
      .orderBy(desc(providersTable.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ total: count() }).from(providersTable).where(where),
  ]);
  const data = await Promise.all(rows.map((r) => serializeProvider(r)));
  return paginate(data, total, page);
}

export async function getProvider(id: string): Promise<ApiProvider> {
  return serializeProvider(await requireProviderRow(id));
}

export async function requireProviderRow(id: string, tx: Executor = db): Promise<ProviderRow> {
  const [row] = await tx.select().from(providersTable).where(eq(providersTable.id, id));
  if (!row) throw new NotFoundError("Provider", id);
  return row;
}

export async function createProvider(input: ProviderInput, actor: string | null): Promise<ApiProvider> {
  const settings = normalizeSettings(input.kind, input.settings, null);
  validateCredential(input.kind, input.credential);

  const row = await db.transaction(async (tx) => {
    let created: ProviderRow;
    try {
      [created] = await tx
        .insert(providersTable)
        .values({ kind: input.kind, name: input.name, settings, status: "OFFLINE" })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("ALREADY_EXISTS", `A provider named "${input.name}" already exists`, { name: input.name });
      }
      throw err;
    }
    await storeCredential(tx, created.id, input.credential);
    await recordEvent(
      {
        kind: "PROVIDER_REGISTERED",
        message: `Registered ${created.kind === "DOCKER_HOST" ? "Docker host" : "ECS cluster"} ${created.name}`,
        actor,
        providerId: created.id,
        details: { kind: created.kind, credentialKind: input.credential.kind },
      },
      tx,
    );
    return created;
  });

  await runConnectivityCheck(row, actor);
  return serializeProvider(await requireProviderRow(row.id));
}

export async function updateProvider(id: string, patch: ProviderUpdate, actor: string | null): Promise<ApiProvider> {
  const existing = await requireProviderRow(id);
  const settings = patch.settings ? normalizeSettings(existing.kind, patch.settings, existing.settings) : existing.settings;
  if (patch.credential) validateCredential(existing.kind, patch.credential);

  await db.transaction(async (tx) => {
    await tx
      .update(providersTable)
      .set({ name: patch.name ?? existing.name, settings })
      .where(eq(providersTable.id, id));
    if (patch.credential) await storeCredential(tx, id, patch.credential);
    await recordEvent(
      {
        kind: "PROVIDER_UPDATED",
        message: `Updated provider ${patch.name ?? existing.name}`,
        actor,
        providerId: id,
        details: {
          fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined),
        },
      },
      tx,
    );
  });

  if (patch.credential || patch.settings) await runConnectivityCheck(await requireProviderRow(id), actor);
  return serializeProvider(await requireProviderRow(id));
}

export async function deleteProvider(id: string, actor: string | null): Promise<void> {
  const row = await requireProviderRow(id);
  const [{ groups }] = await db
    .select({ groups: count() })
    .from(groupsTable)
    .where(eq(groupsTable.providerId, id));
  if (groups > 0) {
    throw new ConflictError(
      "PROVIDER_HAS_GROUPS",
      `Provider ${row.name} still has ${groups} group${groups === 1 ? "" : "s"}; delete them first`,
      { providerId: id, groupCount: groups },
    );
  }
  await db.transaction(async (tx) => {
    await tx.delete(providersTable).where(eq(providersTable.id, id));
    await recordEvent(
      { kind: "PROVIDER_REMOVED", message: `Removed provider ${row.name}`, actor, providerId: id, details: { kind: row.kind } },
      tx,
    );
  });
}

export async function runConnectivityCheck(row: ProviderRow, actor: string | null = null): Promise<ConnectivityReport> {
  const adapter = providerFor(row);
  const credential = await loadCredential(row.id);
  const startedAt = Date.now();
  let result;
  try {
    result = await adapter.checkConnectivity(contextFor(row, credential));
  } catch (err) {
    result = { ok: false, latencyMs: null, message: sanitize((err as Error).message), details: {} };
  }
  const status: ProviderStatus = result.ok ? "ONLINE" : "OFFLINE";
  const checkedAt = new Date();
  await db
    .update(providersTable)
    .set({
      status,
      lastSeenAt: result.ok ? checkedAt : row.lastSeenAt,
      lastError: result.ok ? null : sanitize(result.message),
    })
    .where(eq(providersTable.id, row.id));
  if (status !== row.status) {
    await recordEvent({
      kind: "PROVIDER_STATUS_CHANGED",
      message: `${row.name} is now ${status}${result.ok ? "" : `: ${sanitize(result.message)}`}`,
      actor,
      providerId: row.id,
      details: { from: row.status, to: status },
    });
  }
  return {
    ok: result.ok,
    status,
    checkedAt,
    latencyMs: result.latencyMs ?? (result.ok ? Date.now() - startedAt : null),
    message: sanitize(result.message),
    details: result.details,
  };
}

export async function getPortUsage(id: string): Promise<PortUsage> {
  const row = await requireProviderRow(id);
  const [allocations, workloads] = await Promise.all([
    db
      .select({
        hostPort: portAllocationsTable.hostPort,
        protocol: portAllocationsTable.protocol,
        groupId: portAllocationsTable.groupId,
        groupName: groupsTable.name,
      })
      .from(portAllocationsTable)
      .innerJoin(groupsTable, eq(groupsTable.id, portAllocationsTable.groupId))
      .where(and(eq(portAllocationsTable.providerId, id), ne(portAllocationsTable.state, "RELEASED"))),
    db
      .select({ id: workloadsTable.id, name: workloadsTable.name, ports: workloadsTable.ports })
      .from(workloadsTable)
      .where(and(eq(workloadsTable.providerId, id), ne(workloadsTable.status, "MISSING"))),
  ]);

  const used: PortUsage["used"] = allocations.map((a) => ({
    hostPort: a.hostPort,
    protocol: a.protocol,
    owner: "BERTH",
    groupId: a.groupId,
    groupName: a.groupName,
    workloadId: null,
    workloadName: null,
  }));
  const seen = new Set(used.map((u) => `${u.hostPort}/${u.protocol}`));
  for (const w of workloads) {
    for (const p of w.ports) {
      if (!p.hostPort) continue;
      const key = `${p.hostPort}/${p.protocol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      used.push({
        hostPort: p.hostPort,
        protocol: p.protocol,
        owner: "UNMANAGED",
        groupId: null,
        groupName: null,
        workloadId: w.id,
        workloadName: w.name,
      });
    }
  }
  used.sort((a, b) => a.hostPort - b.hostPort);
  const { portRangeStart, portRangeEnd } = row.settings;
  const usedInRange = used.filter((u) => u.hostPort >= portRangeStart && u.hostPort <= portRangeEnd).length;
  return {
    providerId: id,
    rangeStart: portRangeStart,
    rangeEnd: portRangeEnd,
    used,
    freeInRange: Math.max(0, portRangeEnd - portRangeStart + 1 - usedInRange),
  };
}

export async function loadCredential(providerId: string): Promise<CredentialMaterial | null> {
  const [row] = await db.select().from(credentialsTable).where(eq(credentialsTable.providerId, providerId));
  if (!row) return null;
  return JSON.parse(open(row.ciphertext, providerId)) as CredentialMaterial;
}

export async function serializeProvider(row: ProviderRow): Promise<ApiProvider> {
  const [[credential], [{ workloadCount }], [{ groupCount }]] = await Promise.all([
    db.select().from(credentialsTable).where(eq(credentialsTable.providerId, row.id)),
    db
      .select({ workloadCount: count() })
      .from(workloadsTable)
      .where(and(eq(workloadsTable.providerId, row.id), ne(workloadsTable.status, "MISSING"))),
    db.select({ groupCount: count() }).from(groupsTable).where(eq(groupsTable.providerId, row.id)),
  ]);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    lastError: row.lastError,
    capabilities: capabilitiesFor(row),
    settings: row.settings,
    credential: credential ? serializeCredential(credential) : null,
    workloadCount,
    groupCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeCredential(row: CredentialRow) {
  return {
    kind: row.kind,
    keyVersion: row.keyVersion,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    updatedAt: row.updatedAt,
  };
}

async function storeCredential(tx: Executor, providerId: string, input: CredentialInput): Promise<void> {
  const material: CredentialMaterial = { ...input };
  const ciphertext = seal(JSON.stringify(material), providerId);
  const fingerprint = sha256(JSON.stringify(material)).slice(0, 16);
  await tx
    .insert(credentialsTable)
    .values({ providerId, kind: input.kind, ciphertext, fingerprint, publicKey: null })
    .onConflictDoUpdate({
      target: credentialsTable.providerId,
      set: { kind: input.kind, ciphertext, fingerprint, publicKey: null, updatedAt: sql`now()` },
    });
}

function validateCredential(kind: ProviderRow["kind"], credential: CredentialInput): void {
  const allowed = kind === "DOCKER_HOST" ? DOCKER_CREDENTIALS : ECS_CREDENTIALS;
  if (!allowed.includes(credential.kind)) {
    throw new ValidationError(`${credential.kind} credentials cannot be used with a ${kind}`, {
      kind,
      credentialKind: credential.kind,
      allowed,
    });
  }
  const required: Record<CredentialKind, string[]> = {
    SSH_KEY: ["privateKey"],
    TLS_BUNDLE: ["caCert", "clientCert", "clientKey"],
    AWS_KEYS: ["accessKeyId", "secretAccessKey"],
    AWS_ROLE: ["roleArn"],
  };
  const fields = credential as unknown as Record<string, unknown>;
  const missing = required[credential.kind].filter((f) => !fields[f]);
  if (missing.length > 0) {
    throw new ValidationError(`${credential.kind} credential is missing ${missing.join(", ")}`, { missing });
  }
}

function normalizeSettings(
  kind: ProviderRow["kind"],
  input: Partial<ProviderSettingsRecord>,
  previous: ProviderSettingsRecord | null,
): ProviderSettingsRecord {
  const merged: ProviderSettingsRecord = {
    ...(previous ?? { portRangeStart: DEFAULT_PORT_RANGE.start, portRangeEnd: DEFAULT_PORT_RANGE.end }),
    ...stripUndefined(input),
  };
  if (merged.portRangeStart > merged.portRangeEnd) {
    throw new ValidationError("portRangeStart must be lower than portRangeEnd", {
      portRangeStart: merged.portRangeStart,
      portRangeEnd: merged.portRangeEnd,
    });
  }
  if (kind === "DOCKER_HOST") {
    merged.transport = merged.transport ?? "SSH";
    if (!merged.host) throw new ValidationError("settings.host is required for a Docker host", { field: "settings.host" });
    merged.port = merged.port ?? (merged.transport === "SSH" ? 22 : 2376);
    if (merged.transport === "SSH" && !merged.sshUser) merged.sshUser = "ubuntu";
  } else {
    if (!merged.region) throw new ValidationError("settings.region is required for an ECS cluster", { field: "settings.region" });
    if (!merged.clusterArn) {
      throw new ValidationError("settings.clusterArn is required for an ECS cluster", { field: "settings.clusterArn" });
    }
  }
  return merged;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
