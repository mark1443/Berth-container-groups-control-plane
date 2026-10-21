import type { DiscoveryResult } from "@workspace/api-zod";
import { providersTable, workloadsTable, type ProviderRow, type ProviderStatus } from "@workspace/db";
import { and, eq, ne, notInArray } from "drizzle-orm";
import { db } from "../lib/db";
import { sanitize } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { logger } from "../lib/logger";
import { contextFor, providerFor } from "../providers/registry";
import { detectDriftForProvider } from "./plan";
import { loadCredential } from "./providers";

/**
 * One discovery pass: list what the runtime has, upsert by
 * (provider, externalId), mark the rest MISSING. Never deletes, so member
 * rows keep pointing at something. Updates provider status as a side effect
 * and re-evaluates drift for the provider's applied groups.
 */
export async function discoverProvider(row: ProviderRow, actor: string | null = null): Promise<DiscoveryResult> {
  const startedAt = new Date();
  const adapter = providerFor(row);
  let observed;
  try {
    observed = await adapter.listWorkloads(contextFor(row, await loadCredential(row.id)));
  } catch (err) {
    const message = sanitize((err as Error).message);
    await setStatus(row, "OFFLINE", message, actor);
    return {
      providerId: row.id,
      status: "OFFLINE",
      observedCount: 0,
      startedAt,
      finishedAt: new Date(),
      message: `Discovery failed: ${message}`,
    };
  }

  const seenIds: string[] = [];
  await db.transaction(async (tx) => {
    for (const w of observed) {
      seenIds.push(w.externalId);
      await tx
        .insert(workloadsTable)
        .values({
          providerId: row.id,
          externalId: w.externalId,
          name: w.name,
          image: w.image,
          status: w.status,
          ports: w.ports,
          networks: w.networks,
          labels: w.labels,
          envHash: w.envHash,
          detail: {
            command: w.command,
            mounts: w.mounts,
            restartPolicy: w.restartPolicy,
            health: w.health,
            runtime: w.runtime,
          },
          observedAt: startedAt,
        })
        .onConflictDoUpdate({
          target: [workloadsTable.providerId, workloadsTable.externalId],
          set: {
            name: w.name,
            image: w.image,
            status: w.status,
            ports: w.ports,
            networks: w.networks,
            labels: w.labels,
            envHash: w.envHash,
            detail: {
              command: w.command,
              mounts: w.mounts,
              restartPolicy: w.restartPolicy,
              health: w.health,
              runtime: w.runtime,
            },
            observedAt: startedAt,
          },
        });
    }

    const gone = await tx
      .update(workloadsTable)
      .set({ status: "MISSING", observedAt: startedAt })
      .where(
        and(
          eq(workloadsTable.providerId, row.id),
          ne(workloadsTable.status, "MISSING"),
          seenIds.length > 0 ? notInArray(workloadsTable.externalId, seenIds) : undefined,
        ),
      )
      .returning({ id: workloadsTable.id, name: workloadsTable.name });
    for (const g of gone) {
      await recordEvent(
        {
          kind: "WORKLOAD_MISSING",
          message: `Workload ${g.name} disappeared from ${row.name}`,
          providerId: row.id,
          details: { workloadId: g.id },
        },
        tx,
      );
    }
  });

  await setStatus(row, "ONLINE", null, actor);
  try {
    await detectDriftForProvider(row.id);
  } catch (err) {
    logger.error({ err, providerId: row.id }, "Drift detection failed");
  }
  const finishedAt = new Date();
  await recordEvent({
    kind: "DISCOVERY_COMPLETED",
    message: `Discovered ${observed.length} workload${observed.length === 1 ? "" : "s"} on ${row.name}`,
    actor,
    providerId: row.id,
    details: { observedCount: observed.length, durationMs: finishedAt.getTime() - startedAt.getTime() },
  });
  return {
    providerId: row.id,
    status: "ONLINE",
    observedCount: observed.length,
    startedAt,
    finishedAt,
    message: `Observed ${observed.length} workload${observed.length === 1 ? "" : "s"}`,
  };
}

async function setStatus(row: ProviderRow, status: ProviderStatus, error: string | null, actor: string | null) {
  await db
    .update(providersTable)
    .set({
      status,
      lastError: error,
      ...(status === "ONLINE" ? { lastSeenAt: new Date() } : {}),
    })
    .where(eq(providersTable.id, row.id));
  if (row.status !== status) {
    await recordEvent({
      kind: "PROVIDER_STATUS_CHANGED",
      message: `${row.name} is now ${status}${error ? `: ${error}` : ""}`,
      actor,
      providerId: row.id,
      details: { from: row.status, to: status },
    });
  }
}

/** Poll every provider; used by the background poller. */
export async function discoverAll(): Promise<void> {
  const rows = await db.select().from(providersTable);
  for (const row of rows) {
    try {
      await discoverProvider(row);
    } catch (err) {
      logger.error({ err, providerId: row.id }, "Discovery pass failed");
    }
  }
}
