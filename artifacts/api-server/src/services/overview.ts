import type { ActivityEvent, ActivityEventKind, Overview } from "@workspace/api-zod";
import {
  activityEventsTable,
  groupMembersTable,
  groupsTable,
  operationsTable,
  portAllocationsTable,
  providersTable,
  workloadsTable,
} from "@workspace/db";
import { and, count, desc, eq, gte, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../lib/db";
import { paginate, type PageRequest, type Paginated } from "../lib/pagination";
import { serializeSummary } from "./groups";
import { listOperations } from "./operations";

export async function getOverview(): Promise<Overview> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const [providerRows, workloadRows, [managedRows], groupRows, [ops24], [failed24], [running], [ports], drifted, recent] =
    await Promise.all([
      db.select({ status: providersTable.status, n: count() }).from(providersTable).groupBy(providersTable.status),
      db.select({ status: workloadsTable.status, n: count() }).from(workloadsTable).groupBy(workloadsTable.status),
      db
        .select({ n: count() })
        .from(workloadsTable)
        .innerJoin(groupMembersTable, eq(groupMembersTable.workloadId, workloadsTable.id))
        .where(ne(workloadsTable.status, "MISSING")),
      db.select({ status: groupsTable.status, n: count() }).from(groupsTable).groupBy(groupsTable.status),
      db.select({ n: count() }).from(operationsTable).where(gte(operationsTable.createdAt, since)),
      db
        .select({ n: count() })
        .from(operationsTable)
        .where(and(gte(operationsTable.createdAt, since), inArray(operationsTable.state, ["FAILED", "UNKNOWN"]))),
      db.select({ n: count() }).from(operationsTable).where(inArray(operationsTable.state, ["PENDING", "RUNNING"])),
      db.select({ n: count() }).from(portAllocationsTable).where(ne(portAllocationsTable.state, "RELEASED")),
      db
        .select({ group: groupsTable, provider: providersTable, memberCount: sql<number>`(select count(*)::int from group_members gm where gm.group_id = ${groupsTable.id})` })
        .from(groupsTable)
        .innerJoin(providersTable, eq(providersTable.id, groupsTable.providerId))
        .where(inArray(groupsTable.status, ["DRIFTED", "FAILED"]))
        .orderBy(desc(groupsTable.updatedAt))
        .limit(10),
      listOperations({ page: 1, pageSize: 5, offset: 0 }, {}),
    ]);

  const byStatus = <K extends string>(rows: { status: K; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<K, number>>;
  const p = byStatus(providerRows);
  const w = byStatus(workloadRows);
  const g = byStatus(groupRows);
  const workloadTotal = workloadRows.reduce((acc, r) => acc + r.n, 0);
  const present = workloadTotal - (w.MISSING ?? 0);

  return {
    providers: {
      total: providerRows.reduce((acc, r) => acc + r.n, 0),
      online: p.ONLINE ?? 0,
      offline: p.OFFLINE ?? 0,
      degraded: p.DEGRADED ?? 0,
    },
    workloads: {
      total: workloadTotal,
      running: w.RUNNING ?? 0,
      stopped: w.STOPPED ?? 0,
      missing: w.MISSING ?? 0,
      managed: managedRows.n,
      unmanaged: Math.max(0, present - managedRows.n),
    },
    groups: {
      total: groupRows.reduce((acc, r) => acc + r.n, 0),
      draft: g.DRAFT ?? 0,
      applying: g.APPLYING ?? 0,
      applied: g.APPLIED ?? 0,
      drifted: g.DRIFTED ?? 0,
      failed: g.FAILED ?? 0,
    },
    operations: {
      last24h: ops24.n,
      failed24h: failed24.n,
      running: running.n,
      allocatedPorts: ports.n,
    },
    recentOperations: recent.data,
    driftedGroups: drifted.map((d) => serializeSummary(d.group, d.provider, d.memberCount)),
    generatedAt: new Date(),
  };
}

export interface EventFilter {
  groupId?: string;
  providerId?: string;
  operationId?: string;
  kind?: ActivityEventKind;
  since?: Date;
}

export async function listEvents(page: PageRequest, filter: EventFilter): Promise<Paginated<ActivityEvent>> {
  const conditions: SQL[] = [];
  if (filter.groupId) conditions.push(eq(activityEventsTable.groupId, filter.groupId));
  if (filter.providerId) conditions.push(eq(activityEventsTable.providerId, filter.providerId));
  if (filter.operationId) conditions.push(eq(activityEventsTable.operationId, filter.operationId));
  if (filter.kind) conditions.push(eq(activityEventsTable.kind, filter.kind));
  if (filter.since) conditions.push(gte(activityEventsTable.at, filter.since));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(activityEventsTable)
      .where(where)
      .orderBy(desc(activityEventsTable.at), desc(activityEventsTable.id))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ total: count() }).from(activityEventsTable).where(where),
  ]);
  return paginate(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      at: r.at,
      actor: r.actor,
      providerId: r.providerId,
      groupId: r.groupId,
      operationId: r.operationId,
      details: r.details,
    })),
    total,
    page,
  );
}
