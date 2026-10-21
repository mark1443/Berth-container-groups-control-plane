import type {
  CredentialKind,
  HealthCheckRecord,
  MountRecord,
  PortBindingRecord,
  ProviderKind,
  ProviderSettingsRecord,
  Protocol,
  WorkloadStatus,
} from "@workspace/db";

/**
 * The contract between Berth's core and every runtime (architecture §3,
 * ADR-001). Core never imports dockerode or the AWS SDK; it only talks to
 * this interface. Capabilities are declared, not probed, so the planner
 * can refuse unsupported requests before any network call.
 */
export interface ProviderCapabilities {
  canChooseHostPort: boolean;
  canRecreateInPlace: boolean;
  supportsNativeSecrets: boolean;
  supportsEvents: boolean;
  serviceDiscovery: "DOCKER_DNS" | "SERVICE_CONNECT";
}

export interface ObservedWorkload {
  externalId: string;
  name: string;
  image: string;
  status: WorkloadStatus;
  ports: PortBindingRecord[];
  networks: string[];
  labels: Record<string, string>;
  envHash: string | null;
  command: string[];
  mounts: MountRecord[];
  restartPolicy: string | null;
  health: string | null;
  runtime: Record<string, unknown>;
}

export interface ConnectivityResult {
  ok: boolean;
  latencyMs: number | null;
  message: string;
  details: Record<string, unknown>;
}

export interface NetworkRef {
  ref: string;
  created: boolean;
}

/** Desired state for one member, fully resolved (env rendered, ports chosen). */
export interface MemberPlan {
  memberId: string;
  externalId: string;
  serviceName: string;
  role: "ENTRY" | "INTERNAL" | "EXPOSED";
  containerPort: number;
  hostPort: number | null;
  protocol: Protocol;
  env: Record<string, string>;
  /** Keys whose values come from a native secret store, by reference. */
  secretRefs: Record<string, string>;
  networkRef: string;
  healthCheck: HealthCheckRecord | null;
  labels: Record<string, string>;
}

export interface MemberResult {
  externalId: string;
  changed: boolean;
  summary: string;
}

export interface WorkloadEvent {
  externalId: string;
  kind: "STARTED" | "STOPPED" | "REMOVED" | "CREATED";
  at: Date;
}

export interface CredentialMaterial {
  kind: CredentialKind;
  [field: string]: string | undefined;
}

export interface ProviderContext {
  providerId: string;
  kind: ProviderKind;
  settings: ProviderSettingsRecord;
  credential: CredentialMaterial | null;
}

export interface Provider {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  checkConnectivity(ctx: ProviderContext): Promise<ConnectivityResult>;
  listWorkloads(ctx: ProviderContext): Promise<ObservedWorkload[]>;
  ensureNetwork(ctx: ProviderContext, groupName: string): Promise<NetworkRef>;
  releaseNetwork(ctx: ProviderContext, ref: string): Promise<void>;
  /** Idempotent: converges one workload to its plan and reports whether anything changed. */
  applyMember(ctx: ProviderContext, plan: MemberPlan): Promise<MemberResult>;
  /** Optional event stream; adapters without events return null and rely on polling. */
  watch?(ctx: ProviderContext, onEvent: (e: WorkloadEvent) => void): Promise<() => void>;
}

export const DEFAULT_PORT_RANGE = { start: 20000, end: 29999 } as const;
