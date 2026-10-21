import type { ApplyPlan, PlanStep } from "@workspace/api-zod";
import { groupsTable, workloadsTable, type GroupMemberRow, type PortBindingRecord, type WorkloadRow } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { stableHash } from "../lib/crypto";
import { db, type Executor } from "../lib/db";
import { recordEvent } from "../lib/events";
import { logger } from "../lib/logger";
import type { MemberPlan } from "../providers/provider";
import { resolveMemberEnv } from "./config";
import { hostPortFor, loadGroupBundle, type GroupBundle } from "./groups";

export interface ComputedPlan {
  plan: ApplyPlan;
  memberPlans: MemberPlan[];
  networkRef: string;
}

export function networkRefFor(bundle: GroupBundle): string {
  return bundle.group.networkRef ?? `berth-${bundle.group.name}`;
}

export function memberLabels(bundle: GroupBundle, member: GroupMemberRow): Record<string, string> {
  return {
    "berth.group": bundle.group.name,
    "berth.service": member.serviceName,
    "berth.role": member.role.toLowerCase(),
    "berth.injection-version": String(bundle.group.injectionVersion),
  };
}

/**
 * Desired versus observed, as an ordered list of steps (ADR-006). Pure with
 * respect to the runtime: no provider call happens here, which is what lets
 * `GET /plan` be safe to hit on every page load.
 */
export async function computePlan(bundle: GroupBundle, tx: Executor = db): Promise<ComputedPlan> {
  const { group, provider, members } = bundle;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const steps: PlanStep[] = [];
  const memberPlans: MemberPlan[] = [];
  const networkRef = networkRefFor(bundle);

  if (members.length === 0) blockers.push("The group has no members yet");
  if (!members.some((m) => m.member.role === "ENTRY")) blockers.push("No member holds the ENTRY role");
  if (provider.status !== "ONLINE") blockers.push(`Provider ${provider.name} is ${provider.status}`);
  for (const { member, workload } of members) {
    if (workload.status === "MISSING") blockers.push(`${member.serviceName}: workload ${workload.name} is no longer on the host`);
  }

  const needsNetwork = group.networkRef === null || members.some((m) => !m.workload.networks.includes(networkRef));
  if (needsNetwork) {
    steps.push({
      index: steps.length,
      kind: "ENSURE_NETWORK",
      memberId: null,
      serviceName: null,
      summary: group.networkRef ? `Verify network ${networkRef}` : `Create network ${networkRef}`,
      changes: group.networkRef ? [] : [`network ${networkRef} will be created`],
    });
  }

  for (const { member, workload } of members) {
    const hostPort = hostPortFor(bundle, member);
    if ((member.role === "EXPOSED") && hostPort === null) {
      blockers.push(`${member.serviceName} is EXPOSED but has no host port allocation`);
    }
    const resolved = await resolveMemberEnv(bundle, member.id, tx);
    const labels = memberLabels(bundle, member);
    const plan: MemberPlan = {
      memberId: member.id,
      externalId: workload.externalId,
      serviceName: member.serviceName,
      role: member.role,
      containerPort: member.containerPort,
      hostPort,
      protocol: group.protocol,
      env: resolved.env,
      secretRefs: resolved.secretRefs,
      networkRef,
      healthCheck: member.healthCheck ?? null,
      labels,
    };
    memberPlans.push(plan);

    const changes = diffMember(workload, plan);
    if (changes.length > 0) {
      steps.push({
        index: steps.length,
        kind: "APPLY_MEMBER",
        memberId: member.id,
        serviceName: member.serviceName,
        summary: `${provider.kind === "ECS_CLUSTER" ? "Update service" : "Recreate"} ${member.serviceName} (${workload.name})`,
        changes,
      });
    }
  }

  // Advisory: something Berth does not manage already sits on the entry port.
  const memberWorkloadIds = new Set(members.map((m) => m.workload.id));
  const squatters = await tx
    .select({ id: workloadsTable.id, name: workloadsTable.name, ports: workloadsTable.ports })
    .from(workloadsTable)
    .where(and(eq(workloadsTable.providerId, provider.id), ne(workloadsTable.status, "MISSING")));
  for (const w of squatters) {
    if (memberWorkloadIds.has(w.id)) continue;
    if (w.ports.some((p) => p.hostPort === group.entryPort && p.protocol === group.protocol)) {
      warnings.push(`Host port ${group.entryPort}/${group.protocol} is currently bound by ${w.name}, which is not a member of this group`);
    }
  }

  return {
    plan: {
      groupId: group.id,
      generatedAt: new Date(),
      isNoop: steps.length === 0,
      applicable: blockers.length === 0,
      steps,
      warnings,
      blockers,
    },
    memberPlans,
    networkRef,
  };
}

function diffMember(observed: WorkloadRow, plan: MemberPlan): string[] {
  const changes: string[] = [];
  if (!observed.networks.includes(plan.networkRef)) changes.push(`join network ${plan.networkRef}`);

  const binding = observed.ports.find((p) => p.containerPort === plan.containerPort && p.protocol === plan.protocol);
  const observedHost = binding?.hostPort ?? null;
  if (observedHost !== plan.hostPort) {
    changes.push(
      plan.hostPort === null
        ? `unpublish ${plan.containerPort}/${plan.protocol} (currently ${describeBinding(binding)})`
        : `publish ${plan.hostPort} -> ${plan.containerPort}/${plan.protocol} (currently ${describeBinding(binding)})`,
    );
  }
  if (observed.envHash !== stableHash(plan.env)) changes.push("environment differs from desired state");
  for (const [k, v] of Object.entries(plan.labels)) {
    if (observed.labels[k] !== v) {
      changes.push("berth labels missing or stale");
      break;
    }
  }
  if (observed.status !== "RUNNING") changes.push(`start (currently ${observed.status})`);
  return changes;
}

function describeBinding(binding: PortBindingRecord | undefined): string {
  if (!binding) return "not published";
  return binding.hostPort ? `${binding.hostPort}` : "unpublished";
}

/**
 * Re-evaluate an applied group after anything that changes desired or
 * observed state. DRAFT/FAILED groups keep their status; only groups that
 * were applied can drift.
 */
export async function refreshDrift(groupId: string): Promise<void> {
  try {
    const bundle = await loadGroupBundle(groupId);
    const { group } = bundle;
    if (group.status !== "APPLIED" && group.status !== "DRIFTED") return;
    const { plan } = await computePlan(bundle);
    const reasons = plan.steps.filter((s) => s.changes.length > 0).flatMap((s) => s.changes.map((c) => (s.serviceName ? `${s.serviceName}: ${c}` : c)));
    if (reasons.length > 0 && group.status === "APPLIED") {
      await db.update(groupsTable).set({ status: "DRIFTED", driftReasons: reasons }).where(eq(groupsTable.id, groupId));
      await recordEvent({
        kind: "DRIFT_DETECTED",
        message: `Group ${group.name} drifted: ${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`,
        providerId: group.providerId,
        groupId,
        details: { reasons },
      });
    } else if (reasons.length > 0) {
      if (stableHash(reasons) !== stableHash(group.driftReasons)) {
        await db.update(groupsTable).set({ driftReasons: reasons }).where(eq(groupsTable.id, groupId));
      }
    } else if (group.status === "DRIFTED") {
      await db.update(groupsTable).set({ status: "APPLIED", driftReasons: [] }).where(eq(groupsTable.id, groupId));
    }
  } catch (err) {
    logger.error({ err, groupId }, "Drift refresh failed");
  }
}

export async function detectDriftForProvider(providerId: string): Promise<void> {
  const rows = await db
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(and(eq(groupsTable.providerId, providerId), inArray(groupsTable.status, ["APPLIED", "DRIFTED"])));
  for (const r of rows) await refreshDrift(r.id);
}
