import type { ApplyInput, Operation, OperationState } from "@workspace/api-zod";
import {
  groupsTable,
  operationsTable,
  portAllocationsTable,
  type OperationRow,
  type OperationStepRecord,
} from "@workspace/db";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { stableHash } from "../lib/crypto";
import { db, isUniqueViolation } from "../lib/db";
import { ConflictError, NotFoundError, ValidationError, sanitize } from "../lib/errors";
import { recordEvent } from "../lib/events";
import { logger } from "../lib/logger";
import { paginate, type PageRequest, type Paginated } from "../lib/pagination";
import type { MemberPlan } from "../providers/provider";
import { contextFor, providerFor } from "../providers/registry";
import { discoverProvider } from "./discovery";
import { loadGroupBundle, type GroupBundle } from "./groups";
import { computePlan } from "./plan";
import { loadCredential } from "./providers";

export interface CreateApplyResult {
  operation: Operation;
  replayed: boolean;
}

/**
 * POST /groups/:id/applies (ADR-006). The idempotency key is required; the
 * same key with the same request replays the original operation (200), a
 * different request with the same key is refused (422), and a second apply
 * while one runs is refused (409).
 */
export async function createApply(
  groupId: string,
  idempotencyKey: string,
  input: ApplyInput,
  actor: string | null,
): Promise<CreateApplyResult> {
  const bundle = await loadGroupBundle(groupId);
  const requestHash = stableHash({ groupId, reason: input.reason ?? null });

  const existing = await findByKey(groupId, idempotencyKey);
  if (existing) return replayOrReject(existing, requestHash);

  const [running] = await db
    .select({ id: operationsTable.id })
    .from(operationsTable)
    .where(and(eq(operationsTable.groupId, groupId), inArray(operationsTable.state, ["PENDING", "RUNNING"])));
  if (running) {
    throw new ConflictError("OPERATION_IN_PROGRESS", `Operation ${running.id} is already running for group ${bundle.group.name}`, {
      operationId: running.id,
    });
  }

  const computed = await computePlan(bundle);
  if (!computed.plan.applicable) {
    const entryMissing = computed.plan.blockers.some((b) => b.includes("ENTRY"));
    throw new ValidationError(
      `Group ${bundle.group.name} cannot be applied: ${computed.plan.blockers[0]}`,
      { blockers: computed.plan.blockers },
      entryMissing ? "ENTRY_REQUIRED" : "VALIDATION_ERROR",
    );
  }

  const steps: OperationStepRecord[] = computed.plan.steps.map((s) => ({
    index: s.index,
    kind: s.kind,
    state: "PENDING",
    memberId: s.memberId,
    serviceName: s.serviceName,
    summary: s.summary,
    startedAt: null,
    finishedAt: null,
    error: null,
  }));

  let row: OperationRow;
  try {
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(operationsTable)
        .values({
          groupId,
          kind: "APPLY",
          state: "PENDING",
          idempotencyKey,
          requestHash,
          reason: input.reason ?? null,
          steps,
          createdBy: actor,
        })
        .returning();
      await tx.update(groupsTable).set({ status: "APPLYING" }).where(eq(groupsTable.id, groupId));
      await recordEvent(
        {
          kind: "OPERATION_CREATED",
          message: `Apply started for ${bundle.group.name}: ${steps.length} step${steps.length === 1 ? "" : "s"}${input.reason ? ` (${input.reason})` : ""}`,
          actor,
          providerId: bundle.provider.id,
          groupId,
          operationId: inserted.id,
          details: { stepCount: steps.length, idempotencyKey },
        },
        tx,
      );
      return inserted;
    });
  } catch (err) {
    if (isUniqueViolation(err, "operations_group_idempotency_idx")) {
      const raced = await findByKey(groupId, idempotencyKey);
      if (raced) return replayOrReject(raced, requestHash);
    }
    throw err;
  }

  setImmediate(() => {
    runOperation(row.id, bundle, computed.memberPlans, computed.networkRef).catch((err) => {
      logger.error({ err, operationId: row.id }, "Operation runner crashed");
    });
  });
  return { operation: serializeOperation(row, bundle.group.name), replayed: false };
}

async function findByKey(groupId: string, idempotencyKey: string): Promise<OperationRow | null> {
  const [row] = await db
    .select()
    .from(operationsTable)
    .where(and(eq(operationsTable.groupId, groupId), eq(operationsTable.idempotencyKey, idempotencyKey)));
  return row ?? null;
}

async function replayOrReject(existing: OperationRow, requestHash: string): Promise<CreateApplyResult> {
  if (existing.requestHash !== requestHash) {
    throw new ValidationError(
      "This Idempotency-Key was already used for a different request",
      { operationId: existing.id },
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
  return { operation: await getOperation(existing.id), replayed: true };
}

// ---------------------------------------------------------------------------
// Runner: one step at a time, each outcome written before the next starts.
// ---------------------------------------------------------------------------

async function runOperation(
  operationId: string,
  bundle: GroupBundle,
  memberPlans: MemberPlan[],
  networkRef: string,
): Promise<void> {
  const [op] = await db.select().from(operationsTable).where(eq(operationsTable.id, operationId));
  if (!op || op.state !== "PENDING") return;

  const steps = structuredClone(op.steps);
  const { group, provider } = bundle;
  const adapter = providerFor(provider);
  const ctx = contextFor(provider, await loadCredential(provider.id));
  const persist = (patch: Partial<OperationRow> = {}) =>
    db.update(operationsTable).set({ steps, ...patch }).where(eq(operationsTable.id, operationId));

  await persist({ state: "RUNNING", startedAt: new Date() });

  let failure: { state: Extract<OperationState, "FAILED" | "UNKNOWN">; message: string } | null = null;
  for (const step of steps) {
    if (failure) {
      step.state = "SKIPPED";
      continue;
    }
    step.state = "RUNNING";
    step.startedAt = new Date().toISOString();
    await persist();
    try {
      await executeStep(step, { adapter, ctx, bundle, memberPlans, networkRef });
      step.state = "SUCCEEDED";
    } catch (err) {
      const message = sanitize((err as Error).message ?? String(err));
      const unknown = looksIndeterminate(err);
      step.state = unknown ? "UNKNOWN" : "FAILED";
      step.error = message;
      failure = { state: unknown ? "UNKNOWN" : "FAILED", message };
    }
    step.finishedAt = new Date().toISOString();
    await persist();
  }

  const finishedAt = new Date();
  if (failure) {
    await db.transaction(async (tx) => {
      await tx
        .update(operationsTable)
        .set({ steps, state: failure!.state, error: failure!.message, finishedAt })
        .where(eq(operationsTable.id, operationId));
      await tx
        .update(groupsTable)
        .set({ status: "FAILED", driftReasons: [`Last apply ${failure!.state === "UNKNOWN" ? "ended in an unknown state" : "failed"}: ${failure!.message}`] })
        .where(eq(groupsTable.id, group.id));
      await recordEvent(
        {
          kind: "OPERATION_FINISHED",
          message: `Apply for ${group.name} ${failure!.state === "UNKNOWN" ? "ended in an unknown state" : "failed"}: ${failure!.message}`,
          actor: op.createdBy,
          providerId: provider.id,
          groupId: group.id,
          operationId,
          details: { state: failure!.state, failedStep: steps.find((s) => s.state === "FAILED" || s.state === "UNKNOWN")?.index ?? null },
        },
        tx,
      );
    });
  } else {
    await db.transaction(async (tx) => {
      await tx
        .update(operationsTable)
        .set({ steps, state: "SUCCEEDED", error: null, finishedAt })
        .where(eq(operationsTable.id, operationId));
      await tx
        .update(groupsTable)
        .set({ status: "APPLIED", networkRef, driftReasons: [], lastAppliedAt: finishedAt })
        .where(eq(groupsTable.id, group.id));
      await tx
        .update(portAllocationsTable)
        .set({ state: "APPLIED" })
        .where(and(eq(portAllocationsTable.groupId, group.id), eq(portAllocationsTable.state, "RESERVED")));
      await recordEvent(
        {
          kind: "OPERATION_FINISHED",
          message: `Apply for ${group.name} succeeded (${steps.length} step${steps.length === 1 ? "" : "s"})`,
          actor: op.createdBy,
          providerId: provider.id,
          groupId: group.id,
          operationId,
          details: { state: "SUCCEEDED", stepCount: steps.length },
        },
        tx,
      );
    });
  }

  // Refresh observed state so the group page shows what the runtime has now.
  try {
    await discoverProvider(provider);
  } catch (err) {
    logger.warn({ err, providerId: provider.id }, "Post-apply discovery failed");
  }
}

interface StepContext {
  adapter: ReturnType<typeof providerFor>;
  ctx: ReturnType<typeof contextFor>;
  bundle: GroupBundle;
  memberPlans: MemberPlan[];
  networkRef: string;
}

async function executeStep(step: OperationStepRecord, s: StepContext): Promise<void> {
  switch (step.kind) {
    case "ENSURE_NETWORK": {
      const result = await s.adapter.ensureNetwork(s.ctx, s.bundle.group.name);
      step.summary = result.created ? `Created network ${result.ref}` : `Network ${result.ref} already existed`;
      if (result.ref !== s.networkRef) {
        for (const p of s.memberPlans) p.networkRef = result.ref;
      }
      return;
    }
    case "APPLY_MEMBER": {
      const plan = s.memberPlans.find((p) => p.memberId === step.memberId);
      if (!plan) throw new Error(`No plan for member ${step.memberId}`);
      const result = await s.adapter.applyMember(s.ctx, plan);
      step.summary = `${plan.serviceName}: ${result.summary}`;
      return;
    }
    default:
      step.summary = `${step.kind} is not needed for this runtime`;
      return;
  }
}

function looksIndeterminate(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code && ["ETIMEDOUT", "ECONNRESET", "EPIPE"].includes(e.code)) return true;
  return /timed? ?out|ECONNRESET|socket hang up|connection reset/i.test(e?.message ?? "");
}

/** Operations left PENDING/RUNNING by a previous process can never finish; say so. */
export async function recoverStaleOperations(): Promise<void> {
  const stale = await db
    .select()
    .from(operationsTable)
    .where(inArray(operationsTable.state, ["PENDING", "RUNNING"]));
  for (const op of stale) {
    const message = "The control plane restarted while this operation was running; check the runtime before retrying";
    const steps = op.steps.map((s) => (s.state === "RUNNING" ? { ...s, state: "UNKNOWN" as const, error: message } : s.state === "PENDING" ? { ...s, state: "SKIPPED" as const } : s));
    await db.transaction(async (tx) => {
      await tx
        .update(operationsTable)
        .set({ state: "UNKNOWN", error: message, steps, finishedAt: new Date() })
        .where(eq(operationsTable.id, op.id));
      await tx
        .update(groupsTable)
        .set({ status: "FAILED", driftReasons: [message] })
        .where(and(eq(groupsTable.id, op.groupId), eq(groupsTable.status, "APPLYING")));
      await recordEvent(
        {
          kind: "OPERATION_FINISHED",
          message: `Operation ${op.id} marked UNKNOWN after a control plane restart`,
          groupId: op.groupId,
          operationId: op.id,
          details: { state: "UNKNOWN" },
        },
        tx,
      );
    });
    logger.warn({ operationId: op.id }, "Marked stale operation UNKNOWN");
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listOperations(
  page: PageRequest,
  filter: { groupId?: string; state?: OperationState },
): Promise<Paginated<Operation>> {
  const conditions: SQL[] = [];
  if (filter.groupId) conditions.push(eq(operationsTable.groupId, filter.groupId));
  if (filter.state) conditions.push(eq(operationsTable.state, filter.state));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ op: operationsTable, groupName: groupsTable.name })
      .from(operationsTable)
      .innerJoin(groupsTable, eq(groupsTable.id, operationsTable.groupId))
      .where(where)
      .orderBy(desc(operationsTable.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ total: count() }).from(operationsTable).where(where),
  ]);
  return paginate(
    rows.map((r) => serializeOperation(r.op, r.groupName)),
    total,
    page,
  );
}

export async function getOperation(id: string): Promise<Operation> {
  const [row] = await db
    .select({ op: operationsTable, groupName: groupsTable.name })
    .from(operationsTable)
    .innerJoin(groupsTable, eq(groupsTable.id, operationsTable.groupId))
    .where(eq(operationsTable.id, id));
  if (!row) throw new NotFoundError("Operation", id);
  return serializeOperation(row.op, row.groupName);
}

export function serializeOperation(row: OperationRow, groupName: string): Operation {
  return {
    id: row.id,
    groupId: row.groupId,
    groupName,
    kind: row.kind,
    state: row.state,
    idempotencyKey: row.idempotencyKey,
    reason: row.reason,
    steps: row.steps.map((s) => ({
      index: s.index,
      kind: s.kind,
      state: s.state,
      memberId: s.memberId,
      serviceName: s.serviceName,
      summary: s.summary,
      startedAt: s.startedAt ? new Date(s.startedAt) : null,
      finishedAt: s.finishedAt ? new Date(s.finishedAt) : null,
      error: s.error,
    })),
    error: row.error,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
