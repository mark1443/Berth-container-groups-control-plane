import type { Workload, WorkloadDetail, WorkloadStatus } from "@workspace/api-zod";
import {
  groupMembersTable,
  groupsTable,
  providersTable,
  workloadsTable,
  type GroupMemberRow,
  type ProviderRow,
  type WorkloadRow,
} from "@workspace/db";
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../lib/db";
import { NotFoundError } from "../lib/errors";
import { paginate, type PageRequest, type Paginated } from "../lib/pagination";

export interface WorkloadFilter {
  providerId?: string;
  status?: WorkloadStatus;
  managed?: boolean;
  search?: string;
}

type JoinedRow = {
  workload: WorkloadRow;
  provider: Pick<ProviderRow, "name" | "kind">;
  member: Pick<GroupMemberRow, "id" | "groupId" | "serviceName" | "role"> | null;
  groupName: string | null;
};

export async function listWorkloads(page: PageRequest, filter: WorkloadFilter): Promise<Paginated<Workload>> {
  const conditions: (SQL | undefined)[] = [];
  if (filter.providerId) conditions.push(eq(workloadsTable.providerId, filter.providerId));
  if (filter.status) conditions.push(eq(workloadsTable.status, filter.status));
  if (filter.managed === true) conditions.push(isNotNull(groupMembersTable.id));
  if (filter.managed === false) conditions.push(isNull(groupMembersTable.id));
  if (filter.search) {
    const needle = `%${filter.search.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(workloadsTable.name, needle), ilike(workloadsTable.image, needle)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = () =>
    db
      .select({
        workload: workloadsTable,
        provider: { name: providersTable.name, kind: providersTable.kind },
        member: {
          id: groupMembersTable.id,
          groupId: groupMembersTable.groupId,
          serviceName: groupMembersTable.serviceName,
          role: groupMembersTable.role,
        },
        groupName: groupsTable.name,
      })
      .from(workloadsTable)
      .innerJoin(providersTable, eq(providersTable.id, workloadsTable.providerId))
      .leftJoin(groupMembersTable, eq(groupMembersTable.workloadId, workloadsTable.id))
      .leftJoin(groupsTable, eq(groupsTable.id, groupMembersTable.groupId));

  const [rows, [{ total }]] = await Promise.all([
    base()
      .where(where)
      .orderBy(asc(workloadsTable.name), asc(workloadsTable.id))
      .limit(page.pageSize)
      .offset(page.offset),
    db
      .select({ total: count() })
      .from(workloadsTable)
      .innerJoin(providersTable, eq(providersTable.id, workloadsTable.providerId))
      .leftJoin(groupMembersTable, eq(groupMembersTable.workloadId, workloadsTable.id))
      .where(where),
  ]);
  return paginate(rows.map(serializeJoined), total, page);
}

export async function getWorkload(id: string): Promise<WorkloadDetail> {
  const [row] = await db
    .select({
      workload: workloadsTable,
      provider: { name: providersTable.name, kind: providersTable.kind },
      member: {
        id: groupMembersTable.id,
        groupId: groupMembersTable.groupId,
        serviceName: groupMembersTable.serviceName,
        role: groupMembersTable.role,
      },
      groupName: groupsTable.name,
    })
    .from(workloadsTable)
    .innerJoin(providersTable, eq(providersTable.id, workloadsTable.providerId))
    .leftJoin(groupMembersTable, eq(groupMembersTable.workloadId, workloadsTable.id))
    .leftJoin(groupsTable, eq(groupsTable.id, groupMembersTable.groupId))
    .where(eq(workloadsTable.id, id));
  if (!row) throw new NotFoundError("Workload", id);
  const w = row.workload;
  return {
    ...serializeJoined(row),
    command: w.detail.command,
    mounts: w.detail.mounts,
    restartPolicy: w.detail.restartPolicy,
    health: w.detail.health,
    runtime: w.detail.runtime,
  };
}

export async function requireWorkloadRows(ids: string[]): Promise<Map<string, WorkloadRow>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(workloadsTable).where(inArray(workloadsTable.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function serializeJoined(row: JoinedRow): Workload {
  const w = row.workload;
  const membership =
    row.member && row.member.id && row.member.groupId && row.groupName
      ? {
          groupId: row.member.groupId,
          groupName: row.groupName,
          memberId: row.member.id,
          serviceName: row.member.serviceName ?? "",
          role: row.member.role ?? "INTERNAL",
        }
      : null;
  return {
    id: w.id,
    providerId: w.providerId,
    providerName: row.provider.name,
    providerKind: row.provider.kind,
    externalId: w.externalId,
    name: w.name,
    image: w.image,
    status: w.status,
    ports: w.ports.map((p) => ({ ...p, hostIp: p.hostIp ?? null })),
    networks: w.networks,
    labels: w.labels,
    envHash: w.envHash,
    membership,
    firstSeenAt: w.firstSeenAt,
    observedAt: w.observedAt,
  };
}
