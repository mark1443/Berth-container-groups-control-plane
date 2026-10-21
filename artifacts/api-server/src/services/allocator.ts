import {
  groupsTable,
  portAllocationsTable,
  workloadsTable,
  type PortAllocationRow,
  type Protocol,
} from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Executor } from "../lib/db";
import { ConflictError } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { DEFAULT_PORT_RANGE } from "../providers/provider";

export interface ClaimInput {
  providerId: string;
  groupId: string;
  memberId: string | null;
  protocol: Protocol;
  /** Explicit port (entry port) or null to pick one from the provider range. */
  hostPort: number | null;
  range?: { start: number; end: number };
  actor?: string | null;
}

/**
 * Host-port allocator (ADR-002). A claim is one INSERT; the partial unique
 * index on live rows decides who wins. No advisory locks, no read-then-write
 * window, so twenty parallel claims for the same port yield exactly one row.
 */
export async function claimPort(tx: Executor, input: ClaimInput): Promise<PortAllocationRow> {
  if (input.hostPort !== null) {
    return insertClaim(tx, input, input.hostPort);
  }

  const range = input.range ?? DEFAULT_PORT_RANGE;
  const taken = await takenPorts(tx, input.providerId, input.protocol);
  let attempts = 0;
  for (let port = range.start; port <= range.end && attempts < 25; port++) {
    if (taken.has(port)) continue;
    attempts++;
    try {
      return await insertClaim(tx, input, port, true);
    } catch (err) {
      if (err instanceof ConflictError && err.code === "PORT_IN_USE") {
        taken.add(port); // lost a race; try the next candidate
        continue;
      }
      throw err;
    }
  }
  throw new ConflictError(
    "PORT_RANGE_EXHAUSTED",
    `No free ${input.protocol} host port left in ${range.start}-${range.end} on this provider`,
    { providerId: input.providerId, rangeStart: range.start, rangeEnd: range.end },
  );
}

async function insertClaim(
  tx: Executor,
  input: ClaimInput,
  hostPort: number,
  quiet = false,
): Promise<PortAllocationRow> {
  // ON CONFLICT DO NOTHING keeps the surrounding transaction usable when the
  // claim loses; a raised unique violation would abort it.
  const [row] = await tx
    .insert(portAllocationsTable)
    .values({
      providerId: input.providerId,
      groupId: input.groupId,
      memberId: input.memberId,
      hostPort,
      protocol: input.protocol,
      state: "RESERVED",
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const owner = quiet ? null : await liveOwner(tx, input.providerId, hostPort, input.protocol);
    throw new ConflictError(
      "PORT_IN_USE",
      `Port ${hostPort}/${input.protocol} is already allocated on this provider`,
      {
        hostPort,
        protocol: input.protocol,
        ...(owner ? { groupId: owner.groupId, groupName: owner.groupName } : {}),
      },
    );
  }
  await recordEvent(
    {
      kind: "PORT_RESERVED",
      message: `Reserved host port ${hostPort}/${input.protocol}`,
      actor: input.actor ?? null,
      providerId: input.providerId,
      groupId: input.groupId,
      details: { hostPort, protocol: input.protocol, memberId: input.memberId },
    },
    tx,
  );
  return row;
}

async function liveOwner(tx: Executor, providerId: string, hostPort: number, protocol: Protocol) {
  const [row] = await tx
    .select({ groupId: portAllocationsTable.groupId, groupName: groupsTable.name })
    .from(portAllocationsTable)
    .innerJoin(groupsTable, eq(groupsTable.id, portAllocationsTable.groupId))
    .where(
      and(
        eq(portAllocationsTable.providerId, providerId),
        eq(portAllocationsTable.hostPort, hostPort),
        eq(portAllocationsTable.protocol, protocol),
        ne(portAllocationsTable.state, "RELEASED"),
      ),
    );
  return row ?? null;
}

/** Live allocations plus ports bound by any observed workload on the provider. */
async function takenPorts(tx: Executor, providerId: string, protocol: Protocol): Promise<Set<number>> {
  const taken = new Set<number>();
  const allocations = await tx
    .select({ hostPort: portAllocationsTable.hostPort })
    .from(portAllocationsTable)
    .where(
      and(
        eq(portAllocationsTable.providerId, providerId),
        eq(portAllocationsTable.protocol, protocol),
        ne(portAllocationsTable.state, "RELEASED"),
      ),
    );
  for (const a of allocations) taken.add(a.hostPort);

  const workloads = await tx
    .select({ ports: workloadsTable.ports })
    .from(workloadsTable)
    .where(and(eq(workloadsTable.providerId, providerId), ne(workloadsTable.status, "MISSING")));
  for (const w of workloads) {
    for (const p of w.ports) {
      if (p.hostPort && p.protocol === protocol) taken.add(p.hostPort);
    }
  }
  return taken;
}

export async function releaseAllocations(
  tx: Executor,
  where: { groupId: string; memberId?: string; ids?: string[] },
  actor: string | null = null,
): Promise<PortAllocationRow[]> {
  const conditions = [eq(portAllocationsTable.groupId, where.groupId), ne(portAllocationsTable.state, "RELEASED")];
  if (where.memberId) conditions.push(eq(portAllocationsTable.memberId, where.memberId));
  if (where.ids) {
    if (where.ids.length === 0) return [];
    conditions.push(inArray(portAllocationsTable.id, where.ids));
  }
  const released = await tx
    .update(portAllocationsTable)
    .set({ state: "RELEASED", releasedAt: sql`now()` })
    .where(and(...conditions))
    .returning();
  for (const r of released) {
    await recordEvent(
      {
        kind: "PORT_RELEASED",
        message: `Released host port ${r.hostPort}/${r.protocol}`,
        actor,
        providerId: r.providerId,
        groupId: r.groupId,
        details: { hostPort: r.hostPort, protocol: r.protocol, memberId: r.memberId },
      },
      tx,
    );
  }
  return released;
}

export async function liveAllocations(tx: Executor, groupId: string): Promise<PortAllocationRow[]> {
  return tx
    .select()
    .from(portAllocationsTable)
    .where(and(eq(portAllocationsTable.groupId, groupId), ne(portAllocationsTable.state, "RELEASED")))
    .orderBy(portAllocationsTable.hostPort);
}
