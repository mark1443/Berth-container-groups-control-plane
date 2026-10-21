import type {
  GroupDetail,
  GroupInput,
  GroupMember,
  GroupMemberInput,
  GroupMemberUpdate,
  GroupStatus,
  GroupSummary,
  GroupUpdate,
} from "@workspace/api-zod";
import {
  groupMembersTable,
  groupsTable,
  operationsTable,
  portAllocationsTable,
  providersTable,
  workloadsTable,
  type GroupMemberRow,
  type GroupRow,
  type MemberRole,
  type PortAllocationRow,
  type ProviderRow,
  type WorkloadRow,
} from "@workspace/db";
import { and, asc, count, desc, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { db, isUniqueViolation, type Executor } from "../lib/db";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { logger } from "../lib/logger";
import { paginate, type PageRequest, type Paginated } from "../lib/pagination";
import { contextFor, providerFor } from "../providers/registry";
import { claimPort, liveAllocations, releaseAllocations } from "./allocator";
import { refreshDrift } from "./plan";
import { loadCredential, requireProviderRow } from "./providers";

export interface MemberWithWorkload {
  member: GroupMemberRow;
  workload: WorkloadRow;
}

export interface GroupBundle {
  group: GroupRow;
  provider: ProviderRow;
  members: MemberWithWorkload[];
  allocations: PortAllocationRow[];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listGroups(
  page: PageRequest,
  filter: { providerId?: string; status?: GroupStatus },
): Promise<Paginated<GroupSummary>> {
  const conditions: SQL[] = [];
  if (filter.providerId) conditions.push(eq(groupsTable.providerId, filter.providerId));
  if (filter.status) conditions.push(eq(groupsTable.status, filter.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ group: groupsTable, provider: providersTable })
      .from(groupsTable)
      .innerJoin(providersTable, eq(providersTable.id, groupsTable.providerId))
      .where(where)
      .orderBy(desc(groupsTable.updatedAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ total: count() }).from(groupsTable).where(where),
  ]);
  const counts = await memberCounts(rows.map((r) => r.group.id));
  return paginate(
    rows.map((r) => serializeSummary(r.group, r.provider, counts.get(r.group.id) ?? 0)),
    total,
    page,
  );
}

export async function getGroup(id: string): Promise<GroupDetail> {
  return serializeDetail(await loadGroupBundle(id));
}

export async function loadGroupBundle(id: string, tx: Executor = db): Promise<GroupBundle> {
  const [row] = await tx
    .select({ group: groupsTable, provider: providersTable })
    .from(groupsTable)
    .innerJoin(providersTable, eq(providersTable.id, groupsTable.providerId))
    .where(eq(groupsTable.id, id));
  if (!row) throw new NotFoundError("Group", id);
  const [members, allocations] = await Promise.all([
    tx
      .select({ member: groupMembersTable, workload: workloadsTable })
      .from(groupMembersTable)
      .innerJoin(workloadsTable, eq(workloadsTable.id, groupMembersTable.workloadId))
      .where(eq(groupMembersTable.groupId, id))
      .orderBy(asc(groupMembersTable.createdAt)),
    liveAllocations(tx, id),
  ]);
  // ENTRY first, then the rest in creation order: the apply order.
  members.sort((a, b) => Number(b.member.role === "ENTRY") - Number(a.member.role === "ENTRY"));
  return { group: row.group, provider: row.provider, members, allocations };
}

async function memberCounts(groupIds: string[]): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .select({ groupId: groupMembersTable.groupId, n: count() })
    .from(groupMembersTable)
    .where(inArray(groupMembersTable.groupId, groupIds))
    .groupBy(groupMembersTable.groupId);
  return new Map(rows.map((r) => [r.groupId, r.n]));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createGroup(input: GroupInput, actor: string | null): Promise<GroupDetail> {
  const provider = await requireProviderRow(input.providerId);
  const protocol = input.protocol ?? "TCP";

  const groupId = await db.transaction(async (tx) => {
    let group: GroupRow;
    try {
      [group] = await tx
        .insert(groupsTable)
        .values({
          providerId: provider.id,
          name: input.name,
          description: input.description ?? null,
          entryPort: input.entryPort,
          protocol,
          status: "DRAFT",
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("ALREADY_EXISTS", `A group named "${input.name}" already exists on ${provider.name}`, {
          name: input.name,
          providerId: provider.id,
        });
      }
      throw err;
    }

    // The entry port is claimed before any member exists; the claim is what
    // makes a second group asking for the same port fail with 409.
    await claimPort(tx, {
      providerId: provider.id,
      groupId: group.id,
      memberId: null,
      protocol,
      hostPort: input.entryPort,
      actor,
    });

    for (const m of input.members ?? []) {
      await addMemberInTx(tx, group, provider, m, actor);
    }

    await recordEvent(
      {
        kind: "GROUP_CREATED",
        message: `Created group ${group.name} on ${provider.name} with entry port ${group.entryPort}/${protocol}`,
        actor,
        providerId: provider.id,
        groupId: group.id,
        details: { entryPort: group.entryPort, protocol, memberCount: input.members?.length ?? 0 },
      },
      tx,
    );
    return group.id;
  });

  await refreshDrift(groupId);
  return getGroup(groupId);
}

export async function updateGroup(id: string, patch: GroupUpdate, actor: string | null): Promise<GroupDetail> {
  await db.transaction(async (tx) => {
    const bundle = await loadGroupBundle(id, tx);
    const { group, provider } = bundle;
    assertNotBusy(group);

    const entryPort = patch.entryPort ?? group.entryPort;
    const protocol = patch.protocol ?? group.protocol;
    const portChanged = entryPort !== group.entryPort;
    const protocolChanged = protocol !== group.protocol;

    if (portChanged || protocolChanged) {
      const entryMember = bundle.members.find((m) => m.member.role === "ENTRY");
      const entryAllocation = bundle.allocations.find(
        (a) => a.hostPort === group.entryPort && a.protocol === group.protocol && (a.memberId === null || a.memberId === entryMember?.member.id),
      );
      // Claim the new port first so a failure leaves the old one intact.
      await claimPort(tx, {
        providerId: provider.id,
        groupId: group.id,
        memberId: entryMember?.member.id ?? null,
        protocol,
        hostPort: entryPort,
        actor,
      });
      if (entryAllocation) await releaseAllocations(tx, { groupId: group.id, ids: [entryAllocation.id] }, actor);

      if (protocolChanged) {
        const exposed = bundle.members.filter((m) => m.member.role === "EXPOSED");
        for (const m of exposed) {
          await releaseAllocations(tx, { groupId: group.id, memberId: m.member.id }, actor);
          await claimPort(tx, {
            providerId: provider.id,
            groupId: group.id,
            memberId: m.member.id,
            protocol,
            hostPort: null,
            range: { start: provider.settings.portRangeStart, end: provider.settings.portRangeEnd },
            actor,
          });
        }
      }
    }

    try {
      await tx
        .update(groupsTable)
        .set({
          name: patch.name ?? group.name,
          description: patch.description === undefined ? group.description : patch.description,
          entryPort,
          protocol,
        })
        .where(eq(groupsTable.id, id));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("ALREADY_EXISTS", `A group named "${patch.name}" already exists on ${provider.name}`, {
          name: patch.name,
        });
      }
      throw err;
    }

    await recordEvent(
      {
        kind: "GROUP_UPDATED",
        message: `Updated group ${patch.name ?? group.name}${portChanged ? ` (entry port ${group.entryPort} -> ${entryPort})` : ""}`,
        actor,
        providerId: provider.id,
        groupId: group.id,
        details: { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) },
      },
      tx,
    );
  });
  await refreshDrift(id);
  return getGroup(id);
}

export async function deleteGroup(id: string, actor: string | null): Promise<void> {
  const bundle = await loadGroupBundle(id);
  assertNotBusy(bundle.group);
  const [running] = await db
    .select({ id: operationsTable.id })
    .from(operationsTable)
    .where(and(eq(operationsTable.groupId, id), inArray(operationsTable.state, ["PENDING", "RUNNING"])));
  if (running) {
    throw new ConflictError("OPERATION_IN_PROGRESS", `Operation ${running.id} is still running for this group`, {
      operationId: running.id,
    });
  }

  await db.transaction(async (tx) => {
    await releaseAllocations(tx, { groupId: id }, actor);
    await tx.delete(groupsTable).where(eq(groupsTable.id, id));
    await recordEvent(
      {
        kind: "GROUP_DELETED",
        message: `Deleted group ${bundle.group.name} and released ${bundle.allocations.length} port allocation${bundle.allocations.length === 1 ? "" : "s"}`,
        actor,
        providerId: bundle.provider.id,
        groupId: id,
        details: { networkRef: bundle.group.networkRef, memberCount: bundle.members.length },
      },
      tx,
    );
  });

  if (bundle.group.networkRef) {
    try {
      const adapter = providerFor(bundle.provider);
      await adapter.releaseNetwork(contextFor(bundle.provider, await loadCredential(bundle.provider.id)), bundle.group.networkRef);
    } catch (err) {
      logger.warn({ err, groupId: id }, "Network release failed; it will be reported by the next discovery");
    }
  }
}

export async function addMember(groupId: string, input: GroupMemberInput, actor: string | null): Promise<GroupMember> {
  const memberId = await db.transaction(async (tx) => {
    const bundle = await loadGroupBundle(groupId, tx);
    assertNotBusy(bundle.group);
    const row = await addMemberInTx(tx, bundle.group, bundle.provider, input, actor);
    return row.id;
  });
  await refreshDrift(groupId);
  return requireSerializedMember(groupId, memberId);
}

export async function updateMember(
  groupId: string,
  memberId: string,
  patch: GroupMemberUpdate,
  actor: string | null,
): Promise<GroupMember> {
  await db.transaction(async (tx) => {
    const bundle = await loadGroupBundle(groupId, tx);
    assertNotBusy(bundle.group);
    const current = bundle.members.find((m) => m.member.id === memberId);
    if (!current) throw new NotFoundError("Group member", memberId);
    const { group, provider } = bundle;
    const role: MemberRole = patch.role ?? current.member.role;

    if (role !== current.member.role) {
      if (role === "ENTRY") assertNoOtherEntry(bundle, memberId);
      // Leaving a role gives its port back; entering one takes what it needs.
      if (current.member.role === "ENTRY") await unlinkEntryAllocation(tx, group, memberId);
      if (current.member.role === "EXPOSED") await releaseAllocations(tx, { groupId, memberId }, actor);
      if (role === "ENTRY") await linkEntryAllocation(tx, group, memberId);
      if (role === "EXPOSED") {
        await claimPort(tx, {
          providerId: provider.id,
          groupId,
          memberId,
          protocol: group.protocol,
          hostPort: null,
          range: { start: provider.settings.portRangeStart, end: provider.settings.portRangeEnd },
          actor,
        });
      }
    }

    try {
      await tx
        .update(groupMembersTable)
        .set({
          role,
          serviceName: patch.serviceName ?? current.member.serviceName,
          containerPort: patch.containerPort ?? current.member.containerPort,
          healthCheck: patch.healthCheck === undefined ? current.member.healthCheck : patch.healthCheck,
        })
        .where(eq(groupMembersTable.id, memberId));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ValidationError(`Service name "${patch.serviceName}" is already used in this group`, {
          serviceName: patch.serviceName,
        });
      }
      throw err;
    }

    await recordEvent(
      {
        kind: "MEMBER_UPDATED",
        message: `Updated member ${patch.serviceName ?? current.member.serviceName} in ${group.name}`,
        actor,
        providerId: provider.id,
        groupId,
        details: {
          memberId,
          fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined),
          role,
        },
      },
      tx,
    );
  });
  await refreshDrift(groupId);
  return requireSerializedMember(groupId, memberId);
}

export async function removeMember(groupId: string, memberId: string, actor: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const bundle = await loadGroupBundle(groupId, tx);
    assertNotBusy(bundle.group);
    const current = bundle.members.find((m) => m.member.id === memberId);
    if (!current) throw new NotFoundError("Group member", memberId);

    if (current.member.role === "ENTRY") await unlinkEntryAllocation(tx, bundle.group, memberId);
    else await releaseAllocations(tx, { groupId, memberId }, actor);

    await tx.delete(groupMembersTable).where(eq(groupMembersTable.id, memberId));
    await recordEvent(
      {
        kind: "MEMBER_REMOVED",
        message: `Removed ${current.member.serviceName} (${current.workload.name}) from ${bundle.group.name}`,
        actor,
        providerId: bundle.provider.id,
        groupId,
        details: { memberId, workloadId: current.workload.id, role: current.member.role },
      },
      tx,
    );
  });
  await refreshDrift(groupId);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function addMemberInTx(
  tx: Executor,
  group: GroupRow,
  provider: ProviderRow,
  input: GroupMemberInput,
  actor: string | null,
): Promise<GroupMemberRow> {
  const [workload] = await tx.select().from(workloadsTable).where(eq(workloadsTable.id, input.workloadId));
  if (!workload) throw new NotFoundError("Workload", input.workloadId);
  if (workload.providerId !== group.providerId) {
    throw new ValidationError(
      `Workload ${workload.name} runs on a different provider than group ${group.name}`,
      { workloadId: workload.id, workloadProviderId: workload.providerId, groupProviderId: group.providerId },
      "WORKLOAD_PROVIDER_MISMATCH",
    );
  }
  if (workload.status === "MISSING") {
    throw new ValidationError(`Workload ${workload.name} is no longer present on ${provider.name}`, {
      workloadId: workload.id,
    });
  }

  const role: MemberRole = input.role ?? "INTERNAL";
  if (role === "ENTRY") {
    const [existingEntry] = await tx
      .select({ id: groupMembersTable.id, serviceName: groupMembersTable.serviceName })
      .from(groupMembersTable)
      .where(and(eq(groupMembersTable.groupId, group.id), eq(groupMembersTable.role, "ENTRY")));
    if (existingEntry) {
      throw new ValidationError(
        `Group ${group.name} already has an ENTRY member (${existingEntry.serviceName})`,
        { memberId: existingEntry.id },
        "ENTRY_ALREADY_SET",
      );
    }
  }

  const serviceName = input.serviceName ?? slugify(workload.name);
  let member: GroupMemberRow;
  try {
    [member] = await tx
      .insert(groupMembersTable)
      .values({
        groupId: group.id,
        workloadId: workload.id,
        serviceName,
        role,
        containerPort: input.containerPort,
        healthCheck: input.healthCheck ?? null,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, "group_members_workload_idx")) {
      throw new ValidationError(
        `Workload ${workload.name} already belongs to a group`,
        { workloadId: workload.id },
        "WORKLOAD_ALREADY_MEMBER",
      );
    }
    if (isUniqueViolation(err, "group_members_service_name_idx")) {
      throw new ValidationError(`Service name "${serviceName}" is already used in this group`, { serviceName });
    }
    throw err;
  }

  if (role === "ENTRY") await linkEntryAllocation(tx, group, member.id);
  if (role === "EXPOSED") {
    await claimPort(tx, {
      providerId: provider.id,
      groupId: group.id,
      memberId: member.id,
      protocol: group.protocol,
      hostPort: null,
      range: { start: provider.settings.portRangeStart, end: provider.settings.portRangeEnd },
      actor,
    });
  }

  await recordEvent(
    {
      kind: "MEMBER_ADDED",
      message: `Added ${workload.name} to ${group.name} as ${serviceName} (${role})`,
      actor,
      providerId: provider.id,
      groupId: group.id,
      details: { memberId: member.id, workloadId: workload.id, role, containerPort: input.containerPort },
    },
    tx,
  );
  return member;
}

/** The group's entry allocation follows whichever member holds the ENTRY role. */
async function linkEntryAllocation(tx: Executor, group: GroupRow, memberId: string): Promise<void> {
  await tx
    .update(portAllocationsTable)
    .set({ memberId })
    .where(
      and(
        eq(portAllocationsTable.groupId, group.id),
        eq(portAllocationsTable.hostPort, group.entryPort),
        eq(portAllocationsTable.protocol, group.protocol),
        ne(portAllocationsTable.state, "RELEASED"),
        isNull(portAllocationsTable.memberId),
      ),
    );
}

async function unlinkEntryAllocation(tx: Executor, group: GroupRow, memberId: string): Promise<void> {
  await tx
    .update(portAllocationsTable)
    .set({ memberId: null })
    .where(
      and(
        eq(portAllocationsTable.groupId, group.id),
        eq(portAllocationsTable.memberId, memberId),
        eq(portAllocationsTable.hostPort, group.entryPort),
        ne(portAllocationsTable.state, "RELEASED"),
      ),
    );
}

function assertNoOtherEntry(bundle: GroupBundle, exceptMemberId: string): void {
  const other = bundle.members.find((m) => m.member.role === "ENTRY" && m.member.id !== exceptMemberId);
  if (other) {
    throw new ValidationError(
      `Group ${bundle.group.name} already has an ENTRY member (${other.member.serviceName})`,
      { memberId: other.member.id },
      "ENTRY_ALREADY_SET",
    );
  }
}

function assertNotBusy(group: GroupRow): void {
  if (group.status === "APPLYING") {
    throw new ConflictError("OPERATION_IN_PROGRESS", `Group ${group.name} is being applied right now; wait for the operation to finish`, {
      groupId: group.id,
    });
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return /^[a-z]/.test(slug) ? slug : `svc-${slug}`.slice(0, 63);
}

async function requireSerializedMember(groupId: string, memberId: string): Promise<GroupMember> {
  const bundle = await loadGroupBundle(groupId);
  const found = serializeMembers(bundle).find((m) => m.id === memberId);
  if (!found) throw new NotFoundError("Group member", memberId);
  return found;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeSummary(group: GroupRow, provider: ProviderRow, memberCount: number): GroupSummary {
  return {
    id: group.id,
    providerId: group.providerId,
    providerName: provider.name,
    providerKind: provider.kind,
    name: group.name,
    description: group.description,
    entryPort: group.entryPort,
    protocol: group.protocol,
    status: group.status,
    networkRef: group.networkRef,
    injectionPrefix: group.injectionPrefix,
    injectionVersion: group.injectionVersion,
    driftReasons: group.driftReasons,
    memberCount,
    lastAppliedAt: group.lastAppliedAt,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export function serializeDetail(bundle: GroupBundle): GroupDetail {
  return {
    ...serializeSummary(bundle.group, bundle.provider, bundle.members.length),
    members: serializeMembers(bundle),
    allocations: bundle.allocations.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      groupId: a.groupId,
      memberId: a.memberId,
      hostPort: a.hostPort,
      protocol: a.protocol,
      state: a.state,
      createdAt: a.createdAt,
      releasedAt: a.releasedAt,
    })),
  };
}

export function hostPortFor(bundle: GroupBundle, member: GroupMemberRow): number | null {
  if (member.role === "ENTRY") return bundle.group.entryPort;
  if (member.role === "INTERNAL") return null;
  return bundle.allocations.find((a) => a.memberId === member.id)?.hostPort ?? null;
}

export function serializeMembers(bundle: GroupBundle): GroupMember[] {
  return bundle.members.map(({ member, workload }) => ({
    id: member.id,
    groupId: member.groupId,
    workloadId: workload.id,
    workloadName: workload.name,
    workloadImage: workload.image,
    workloadStatus: workload.status,
    serviceName: member.serviceName,
    role: member.role,
    containerPort: member.containerPort,
    hostPort: hostPortFor(bundle, member),
    healthCheck: member.healthCheck ?? null,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  }));
}
