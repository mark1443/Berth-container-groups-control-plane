import type { ProviderRow } from "@workspace/db";
import { fakeProvider } from "./fake";
import type { Provider, ProviderCapabilities, ProviderContext } from "./provider";

/**
 * Adapters for real runtimes land in Phase 2 (Docker over SSH, ECS). Until
 * then a registered host is kept, its credential stays sealed, and every
 * call reports the gap instead of pretending.
 */
class PendingProvider implements Provider {
  constructor(
    readonly kind: ProviderRow["kind"],
    readonly capabilities: ProviderCapabilities,
    private readonly label: string,
  ) {}

  async checkConnectivity(): Promise<{ ok: boolean; latencyMs: null; message: string; details: Record<string, unknown> }> {
    return {
      ok: false,
      latencyMs: null,
      message: `${this.label} adapter is not available in this build yet; the provider stays OFFLINE`,
      details: { adapter: "pending" },
    };
  }
  async listWorkloads(): Promise<never[]> {
    return [];
  }
  async ensureNetwork(): Promise<never> {
    throw new Error(`${this.label} adapter is not available in this build yet`);
  }
  async releaseNetwork(): Promise<void> {}
  async applyMember(): Promise<never> {
    throw new Error(`${this.label} adapter is not available in this build yet`);
  }
}

const dockerPending = new PendingProvider(
  "DOCKER_HOST",
  {
    canChooseHostPort: true,
    canRecreateInPlace: true,
    supportsNativeSecrets: false,
    supportsEvents: true,
    serviceDiscovery: "DOCKER_DNS",
  },
  "Docker host",
);

const ecsPending = new PendingProvider(
  "ECS_CLUSTER",
  {
    canChooseHostPort: false,
    canRecreateInPlace: false,
    supportsNativeSecrets: true,
    supportsEvents: false,
    serviceDiscovery: "SERVICE_CONNECT",
  },
  "ECS",
);

export function providerFor(row: Pick<ProviderRow, "kind" | "runtime">): Provider {
  if (row.runtime === "fake") return fakeProvider;
  if (row.kind === "ECS_CLUSTER") return ecsPending;
  return dockerPending;
}

export function capabilitiesFor(row: Pick<ProviderRow, "kind" | "runtime">): ProviderCapabilities {
  return providerFor(row).capabilities;
}

export function contextFor(
  row: Pick<ProviderRow, "id" | "kind" | "settings">,
  credential: ProviderContext["credential"] = null,
): ProviderContext {
  return { providerId: row.id, kind: row.kind, settings: row.settings, credential };
}
