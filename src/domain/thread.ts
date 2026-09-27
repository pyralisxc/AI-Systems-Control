import type {
  AccountDomainId,
  IsoTimestamp,
  PrincipalId,
  ProjectId
} from "./shared.js";

export const THREAD_MODES = ["external", "bridged", "managed"] as const;
export type ThreadMode = (typeof THREAD_MODES)[number];

export const THREAD_LIFECYCLES = [
  "active",
  "waiting_owner",
  "idle",
  "completed",
  "archived"
] as const;
export type ThreadLifecycle = (typeof THREAD_LIFECYCLES)[number];

export interface ThreadRuntimeCapabilities {
  readonly canPublishCheckpoint: boolean;
  readonly canSteer: boolean;
  readonly canInterrupt: boolean;
  readonly canStopRuntime: boolean;
  readonly canAutoSendRelay: boolean;
}

export interface ExternalThreadReference {
  readonly provider: string;
  readonly externalThreadId?: string;
  readonly navigationUrl?: string;
}

export interface ConversationThread {
  readonly threadId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId?: ProjectId;
  readonly title: string;
  readonly purpose?: string;
  readonly mode: ThreadMode;
  readonly lifecycle: ThreadLifecycle;
  readonly runtimeCapabilities: ThreadRuntimeCapabilities;
  readonly externalReference?: ExternalThreadReference;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export const STEERING_ACTORS = [
  "owner",
  "owner_assisted",
  "founder_relay"
] as const;
export type SteeringActor = (typeof STEERING_ACTORS)[number];

export interface SteeringReference {
  readonly actor: SteeringActor;
  readonly text: string;
  readonly principalId?: PrincipalId;
  readonly messageRef?: string;
}

export const THREAD_GATES = [
  "none",
  "owner",
  "blocked",
  "waiting_external"
] as const;
export type ThreadGate = (typeof THREAD_GATES)[number];

export interface ThreadCheckpoint {
  readonly checkpointId: string;
  readonly threadId: string;
  readonly accountDomainId: AccountDomainId;
  readonly publishedAt: IsoTimestamp;
  readonly synopsis: string;
  readonly gate: ThreadGate;
  readonly blocker?: string;
  readonly workReferences: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly publishedByPrincipalId?: PrincipalId;
  readonly supersedesCheckpointId?: string;
  readonly lastSteering?: SteeringReference;
}

export const THREAD_ACTIVITY_KINDS = [
  "checkpoint",
  "meaningful_progress",
  "tool_success",
  "tool_failure",
  "heartbeat",
  "waiting",
  "owner_gate",
  "blocked",
  "completed",
  "stopped"
] as const;
export type ThreadActivityKind =
  (typeof THREAD_ACTIVITY_KINDS)[number];

export interface ThreadActivityEvent {
  readonly activityId: string;
  readonly threadId: string;
  readonly accountDomainId: AccountDomainId;
  readonly occurredAt: IsoTimestamp;
  readonly kind: ThreadActivityKind;
  readonly source: string;
  readonly signature?: string;
  readonly summary?: string;
  readonly evidenceReference?: string;
  readonly publishedByPrincipalId?: PrincipalId;
}

export const PULSE_STATUSES = [
  "working",
  "waiting",
  "needs_you",
  "blocked",
  "possible_loop",
  "stalled",
  "stopped",
  "completed",
  "idle"
] as const;
export type PulseStatus = (typeof PULSE_STATUSES)[number];

export interface PulseProjection {
  readonly threadId: string;
  readonly accountDomainId: AccountDomainId;
  readonly status: PulseStatus;
  readonly reason: string;
  readonly lastActivityAt?: IsoTimestamp;
  readonly repeatedFailureCount?: number;
  readonly latestCheckpointId?: string;
}
