// Unit tests for the pure parts of the API server. Run with:
//   pnpm --filter @workspace/api-server test
// Uses Node's built-in runner and type stripping; no database required.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.BERTH_MASTER_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.LOG_LEVEL ??= "silent";

const { AppError, ConflictError, NotFoundError, ValidationError, sanitize } = await import("../src/lib/errors");
const { paginate, paginateArray, parsePagination } = await import("../src/lib/pagination");
const { open, seal, stableHash } = await import("../src/lib/crypto");
const { FakeProvider, demoContainers } = await import("../src/providers/fake");

describe("errors", () => {
  it("serialises the single error envelope", () => {
    const err = new ConflictError("PORT_IN_USE", "Port 8080/TCP is already allocated", { hostPort: 8080 });
    assert.equal(err.status, 409);
    assert.deepEqual(err.toBody(), {
      error: { code: "PORT_IN_USE", message: "Port 8080/TCP is already allocated", details: { hostPort: 8080 } },
    });
    assert.ok(err instanceof AppError);
  });
  it("maps not-found and validation to 404 / 422", () => {
    assert.equal(new NotFoundError("Group", "g1").status, 404);
    assert.equal(new ValidationError("bad").status, 422);
    assert.equal(new ValidationError("bad", {}, "ENTRY_REQUIRED").code, "ENTRY_REQUIRED");
  });
  it("redacts secrets and key material from messages", () => {
    assert.equal(sanitize("password=hunter2 failed"), "password=[redacted] failed");
    assert.equal(sanitize("Bearer abc.def-ghi"), "Bearer [redacted]");
    assert.equal(sanitize("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"), "[redacted key material]");
  });
});

describe("pagination", () => {
  it("defaults and computes offsets", () => {
    assert.deepEqual(parsePagination({}), { page: 1, pageSize: 50, offset: 0 });
    assert.deepEqual(parsePagination({ page: "3", pageSize: "20" }), { page: 3, pageSize: 20, offset: 40 });
  });
  it("rejects out-of-range input instead of clamping", () => {
    assert.throws(() => parsePagination({ pageSize: "1000" }), (e: unknown) => e instanceof ValidationError);
    assert.throws(() => parsePagination({ page: "0" }), (e: unknown) => e instanceof ValidationError);
    assert.throws(() => parsePagination({ page: "x" }), (e: unknown) => e instanceof ValidationError);
  });
  it("reports totals", () => {
    assert.deepEqual(paginate([1, 2], 7, { page: 2, pageSize: 2 }).pagination, { page: 2, pageSize: 2, totalItems: 7, totalPages: 4 });
    assert.deepEqual(paginateArray([1, 2, 3, 4, 5], { page: 2, pageSize: 2, offset: 2 }).data, [3, 4]);
    assert.equal(paginate([], 0, { page: 1, pageSize: 50 }).pagination.totalPages, 1);
  });
});

describe("crypto", () => {
  it("round-trips and binds ciphertext to its AAD", () => {
    const sealed = seal("hunter2", "provider:1");
    assert.notEqual(sealed, "hunter2");
    assert.equal(open(sealed, "provider:1"), "hunter2");
    assert.throws(() => open(sealed, "provider:2"));
  });
  it("hashes structurally, independent of key order", () => {
    assert.equal(stableHash({ a: 1, b: [1, 2] }), stableHash({ b: [1, 2], a: 1 }));
    assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
  });
});

describe("fake provider", () => {
  const ctx = (providerId: string) => ({
    providerId,
    kind: "DOCKER_HOST" as const,
    settings: { portRangeStart: 20000, portRangeEnd: 20099 },
    credential: null,
  });

  it("lists seeded containers and reports connectivity", async () => {
    const p = new FakeProvider();
    p.seed("h1", demoContainers());
    const check = await p.checkConnectivity(ctx("h1"));
    assert.equal(check.ok, true);
    const list = await p.listWorkloads(ctx("h1"));
    assert.equal(list.length, 7);
    assert.ok(list.some((w) => w.name === "edge-nginx" && w.ports[0]?.hostPort === 8080));
  });

  it("converges a member idempotently", async () => {
    const p = new FakeProvider();
    p.seed("h1", demoContainers());
    const net = await p.ensureNetwork(ctx("h1"), "shop");
    assert.deepEqual(net, { ref: "berth-shop", created: true });
    const plan = {
      memberId: "m1",
      externalId: "c0ffee000002",
      serviceName: "api",
      role: "INTERNAL" as const,
      containerPort: 3000,
      hostPort: null,
      protocol: "TCP" as const,
      env: { NODE_ENV: "production", SVC_DB_HOST: "db" },
      secretRefs: {},
      networkRef: "berth-shop",
      healthCheck: null,
      labels: { "berth.group": "shop" },
    };
    const first = await p.applyMember(ctx("h1"), plan);
    assert.equal(first.changed, true);
    const second = await p.applyMember(ctx("h1"), plan);
    assert.equal(second.changed, false);
    const c = p.getContainer("h1", "c0ffee000002")!;
    assert.deepEqual(c.networks, ["berth-shop"]);
    assert.equal(c.labels["berth.group"], "shop");
    assert.equal((await p.listWorkloads(ctx("h1"))).find((w) => w.externalId === "c0ffee000002")!.envHash, stableHash(plan.env));
  });

  it("injects one-shot failures", async () => {
    const p = new FakeProvider();
    p.seed("h1", demoContainers());
    p.failNext("h1", "applyMember", "daemon busy");
    await assert.rejects(
      p.applyMember(ctx("h1"), {
        memberId: "m", externalId: "c0ffee000001", serviceName: "edge", role: "ENTRY", containerPort: 80, hostPort: 8080,
        protocol: "TCP", env: {}, secretRefs: {}, networkRef: "berth-x", healthCheck: null, labels: {},
      }),
      /daemon busy/,
    );
    p.failNext("h1", "checkConnectivity", "ssh: connect to host demo.internal port 22: Connection refused");
    assert.equal((await p.checkConnectivity(ctx("h1"))).ok, false);
    assert.equal((await p.checkConnectivity(ctx("h1"))).ok, true);
  });

  it("keeps hydrated state across restarts", async () => {
    const p = new FakeProvider();
    p.seed("h1", demoContainers());
    const rows = (await p.listWorkloads(ctx("h1"))).map((w) => ({
      ...w,
      id: w.externalId, providerId: "h1", detail: { command: w.command, mounts: [], restartPolicy: null, health: null, runtime: w.runtime },
      firstSeenAt: new Date(), observedAt: new Date(),
    }));
    const fresh = new FakeProvider();
    fresh.hydrate("h1", rows as never);
    assert.equal((await fresh.listWorkloads(ctx("h1"))).length, 7);
  });
});
