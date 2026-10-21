import type { PortBindingRecord, WorkloadRow } from "@workspace/db";
import { stableHash } from "../lib/crypto";
import type {
  ConnectivityResult,
  MemberPlan,
  MemberResult,
  NetworkRef,
  ObservedWorkload,
  Provider,
  ProviderCapabilities,
  ProviderContext,
} from "./provider";

export interface FakeContainer {
  externalId: string;
  name: string;
  image: string;
  status: "RUNNING" | "STOPPED";
  ports: PortBindingRecord[];
  networks: string[];
  labels: Record<string, string>;
  env: Record<string, string>;
  command: string[];
  createdAt: string;
}

interface HostState {
  containers: Map<string, FakeContainer>;
  networks: Set<string>;
  failures: Partial<Record<"checkConnectivity" | "applyMember" | "ensureNetwork" | "listWorkloads", string>>;
  latencyMs: number;
}

/**
 * In-memory runtime used by the contract tests and by the demo host. It
 * behaves like a very small Docker daemon: containers, user networks, port
 * bindings, env. `failNext` injects a one-shot failure so the apply runner's
 * error paths can be exercised without a real host.
 */
export class FakeProvider implements Provider {
  readonly kind = "DOCKER_HOST" as const;
  readonly capabilities: ProviderCapabilities = {
    canChooseHostPort: true,
    canRecreateInPlace: true,
    supportsNativeSecrets: false,
    supportsEvents: false,
    serviceDiscovery: "DOCKER_DNS",
  };

  private hosts = new Map<string, HostState>();

  host(providerId: string): HostState {
    let h = this.hosts.get(providerId);
    if (!h) {
      h = { containers: new Map(), networks: new Set(["bridge"]), failures: {}, latencyMs: 3 };
      this.hosts.set(providerId, h);
    }
    return h;
  }

  seed(providerId: string, containers: FakeContainer[]): void {
    const h = this.host(providerId);
    h.containers.clear();
    for (const c of containers) h.containers.set(c.externalId, structuredClone(c));
  }

  /** Rebuild in-memory state from previously observed rows (survives restarts). */
  hydrate(providerId: string, rows: WorkloadRow[], envByExternalId: Record<string, Record<string, string>> = {}): void {
    const h = this.host(providerId);
    for (const row of rows) {
      if (row.status === "MISSING") continue;
      const seeded = h.containers.get(row.externalId);
      h.containers.set(row.externalId, {
        externalId: row.externalId,
        name: row.name,
        image: row.image,
        status: row.status === "RUNNING" ? "RUNNING" : "STOPPED",
        ports: row.ports,
        networks: row.networks,
        labels: row.labels,
        env: envByExternalId[row.externalId] ?? seeded?.env ?? {},
        command: row.detail.command,
        createdAt: String(row.detail.runtime.created ?? row.firstSeenAt.toISOString()),
      });
      for (const n of row.networks) h.networks.add(n);
    }
  }

  failNext(providerId: string, op: keyof HostState["failures"], message: string): void {
    this.host(providerId).failures[op] = message;
  }

  setEnv(providerId: string, externalId: string, env: Record<string, string>): void {
    const c = this.host(providerId).containers.get(externalId);
    if (c) c.env = { ...env };
  }

  getContainer(providerId: string, externalId: string): FakeContainer | undefined {
    return this.host(providerId).containers.get(externalId);
  }

  networks(providerId: string): string[] {
    return [...this.host(providerId).networks];
  }

  private takeFailure(h: HostState, op: keyof HostState["failures"]): void {
    const msg = h.failures[op];
    if (msg) {
      delete h.failures[op];
      throw new Error(msg);
    }
  }

  async checkConnectivity(ctx: ProviderContext): Promise<ConnectivityResult> {
    const h = this.host(ctx.providerId);
    try {
      this.takeFailure(h, "checkConnectivity");
    } catch (err) {
      return { ok: false, latencyMs: null, message: (err as Error).message, details: {} };
    }
    return {
      ok: true,
      latencyMs: h.latencyMs,
      message: "In-memory runtime reachable",
      details: {
        dockerVersion: "fake-27.0",
        containerCount: h.containers.size,
        networkCount: h.networks.size,
      },
    };
  }

  async listWorkloads(ctx: ProviderContext): Promise<ObservedWorkload[]> {
    const h = this.host(ctx.providerId);
    this.takeFailure(h, "listWorkloads");
    return [...h.containers.values()].map((c) => ({
      externalId: c.externalId,
      name: c.name,
      image: c.image,
      status: c.status,
      ports: structuredClone(c.ports),
      networks: [...c.networks],
      labels: { ...c.labels },
      envHash: stableHash(c.env),
      command: [...c.command],
      mounts: [],
      restartPolicy: "unless-stopped",
      health: c.status === "RUNNING" ? "healthy" : null,
      runtime: { created: c.createdAt, state: c.status.toLowerCase(), fake: true },
    }));
  }

  async ensureNetwork(ctx: ProviderContext, groupName: string): Promise<NetworkRef> {
    const h = this.host(ctx.providerId);
    this.takeFailure(h, "ensureNetwork");
    const ref = `berth-${groupName}`;
    const created = !h.networks.has(ref);
    h.networks.add(ref);
    return { ref, created };
  }

  async releaseNetwork(ctx: ProviderContext, ref: string): Promise<void> {
    const h = this.host(ctx.providerId);
    h.networks.delete(ref);
    for (const c of h.containers.values()) {
      c.networks = c.networks.filter((n) => n !== ref);
    }
  }

  async applyMember(ctx: ProviderContext, plan: MemberPlan): Promise<MemberResult> {
    const h = this.host(ctx.providerId);
    this.takeFailure(h, "applyMember");
    const c = h.containers.get(plan.externalId);
    if (!c) throw new Error(`Container ${plan.externalId} no longer exists on the host`);

    const desiredPorts: PortBindingRecord[] = [
      { containerPort: plan.containerPort, hostPort: plan.hostPort, protocol: plan.protocol, hostIp: plan.hostPort ? "0.0.0.0" : null },
    ];
    const desiredNetworks = [...new Set([...c.networks.filter((n) => n !== "bridge" && !n.startsWith("berth-")), plan.networkRef])];
    const desiredLabels = { ...c.labels, ...plan.labels };
    const changes: string[] = [];
    if (stableHash(c.ports) !== stableHash(desiredPorts)) changes.push("ports");
    if (stableHash([...c.networks].sort()) !== stableHash([...desiredNetworks].sort())) changes.push("network");
    if (stableHash(c.env) !== stableHash(plan.env)) changes.push("env");
    if (stableHash(c.labels) !== stableHash(desiredLabels)) changes.push("labels");
    if (c.status !== "RUNNING") changes.push("started");

    if (changes.length === 0) {
      return { externalId: c.externalId, changed: false, summary: "Already converged" };
    }
    c.ports = desiredPorts;
    c.networks = desiredNetworks;
    c.env = { ...plan.env };
    c.labels = desiredLabels;
    c.status = "RUNNING";
    c.createdAt = new Date().toISOString();
    return { externalId: c.externalId, changed: true, summary: `Recreated (${changes.join(", ")})` };
  }
}

export const fakeProvider = new FakeProvider();

export function demoContainers(): FakeContainer[] {
  const created = new Date(Date.now() - 36 * 3600_000).toISOString();
  const mk = (
    externalId: string,
    name: string,
    image: string,
    ports: PortBindingRecord[],
    env: Record<string, string>,
    status: "RUNNING" | "STOPPED" = "RUNNING",
    command: string[] = [],
  ): FakeContainer => ({
    externalId,
    name,
    image,
    status,
    ports,
    networks: ["bridge"],
    labels: { "com.docker.compose.project": "shop", "berth.demo": "true" },
    env,
    command,
    createdAt: created,
  });
  return [
    mk("c0ffee000001", "edge-nginx", "nginx:1.27-alpine", [{ containerPort: 80, hostPort: 8080, protocol: "TCP", hostIp: "0.0.0.0" }], { NGINX_ENTRYPOINT_QUIET_LOGS: "1" }),
    mk("c0ffee000002", "shop-api", "ghcr.io/acme/shop-api:2.4.1", [{ containerPort: 3000, hostPort: null, protocol: "TCP" }], { NODE_ENV: "production", PORT: "3000" }, "RUNNING", ["node", "dist/server.js"]),
    mk("c0ffee000003", "shop-worker", "ghcr.io/acme/shop-api:2.4.1", [], { NODE_ENV: "production", ROLE: "worker" }, "RUNNING", ["node", "dist/worker.js"]),
    mk("c0ffee000004", "shop-postgres", "postgres:16-alpine", [{ containerPort: 5432, hostPort: 5432, protocol: "TCP", hostIp: "127.0.0.1" }], { POSTGRES_DB: "shop", PGDATA: "/var/lib/postgresql/data" }),
    mk("c0ffee000005", "shop-redis", "redis:7-alpine", [{ containerPort: 6379, hostPort: null, protocol: "TCP" }], {}, "RUNNING", ["redis-server", "--appendonly", "yes"]),
    mk("c0ffee000006", "grafana", "grafana/grafana:11.2.0", [{ containerPort: 3000, hostPort: 3001, protocol: "TCP", hostIp: "0.0.0.0" }], { GF_SECURITY_ADMIN_USER: "admin" }),
    mk("c0ffee000007", "legacy-cron", "alpine:3.20", [], { TZ: "UTC" }, "STOPPED", ["crond", "-f"]),
  ];
}
