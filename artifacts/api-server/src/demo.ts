import { groupsTable, providersTable, workloadsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./lib/db";
import { logger } from "./lib/logger";
import { demoContainers, fakeProvider } from "./providers/fake";
import { resolveMemberEnv } from "./services/config";
import { discoverProvider } from "./services/discovery";
import { loadGroupBundle } from "./services/groups";

export const DEMO_PROVIDER_NAME = "demo-host";

/**
 * The demo host is an in-memory Docker-like runtime so the console has
 * something real to show before a Docker or ECS adapter is connected. It is
 * never created in production. State observed in earlier runs is rebuilt
 * from the database so applied groups survive a restart.
 */
export async function ensureDemoProvider(): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.BERTH_DEMO === "0") return;

  let [row] = await db.select().from(providersTable).where(eq(providersTable.runtime, "fake"));
  if (!row) {
    [row] = await db
      .insert(providersTable)
      .values({
        kind: "DOCKER_HOST",
        runtime: "fake",
        name: DEMO_PROVIDER_NAME,
        status: "OFFLINE",
        settings: {
          transport: "SSH",
          host: "demo.internal",
          port: 22,
          sshUser: "ubuntu",
          portRangeStart: 20000,
          portRangeEnd: 20099,
        },
      })
      .returning();
    logger.info({ providerId: row.id }, "Seeded demo host");
  }

  const rows = await db.select().from(workloadsTable).where(eq(workloadsTable.providerId, row.id));
  fakeProvider.seed(row.id, demoContainers());
  if (rows.length > 0) {
    fakeProvider.hydrate(row.id, rows);
    await restoreAppliedEnv(row.id);
  }
  await discoverProvider(row);
}

/**
 * The fake runtime keeps env in memory only. For groups that were applied
 * before the restart, put back exactly what the apply rendered so the
 * next discovery does not report every member as drifted.
 */
async function restoreAppliedEnv(providerId: string): Promise<void> {
  const groups = await db
    .select({ id: groupsTable.id })
    .from(groupsTable)
    .where(and(eq(groupsTable.providerId, providerId), inArray(groupsTable.status, ["APPLIED", "DRIFTED"])));
  for (const g of groups) {
    const bundle = await loadGroupBundle(g.id);
    for (const { member, workload } of bundle.members) {
      try {
        const { env } = await resolveMemberEnv(bundle, member.id);
        fakeProvider.setEnv(providerId, workload.externalId, env);
      } catch (err) {
        logger.warn({ err, memberId: member.id }, "Could not restore demo env; member will show as drifted");
      }
    }
  }
}
