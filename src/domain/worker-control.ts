import type {
  AccountDomainId,
  IsoTimestamp,
  PrincipalId,
  ProjectId
} from "./shared.js";
import type { EffectClass } from "./capability.js";

export const WORK_AUTHORIZATION_STATES = [
  "active",
  "revoked",
  "superseded",
  "needs_revalidation"
] as const;
export type WorkAuthorizationState =
  (typeof WORK_AUTHORIZATION_STATES)[number];

export const WORK_VERIFICATION_KINDS = ["intent", "result"] as const;
export type WorkVerificationKind =
  (typeof WORK_VERIFICATION_KINDS)[number];

export interface ApprovalRecord {
  readonly approvalId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly approvedByPrincipalId: PrincipalId;
  readonly membershipId: string;
  readonly workReference: string;
  readonly scopeFingerprint: string;
  readonly verificationKind: WorkVerificationKind;
  readonly approvedAt: IsoTimestamp;
}

export interface WorkAuthorization {
  readonly authorizationId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly approvalId: string;
  readonly workReference: string;
  readonly scopeFingerprint: string;
  readonly verificationKind: WorkVerificationKind;
  readonly approvedByPrincipalId: PrincipalId;
  readonly state: WorkAuthorizationState;
  readonly authorizedAt: IsoTimestamp;
}

export const WORKER_RUN_STATES = [
  "starting",
  "active",
  "blocked",
  "completed",
  "stopped",
  "failed"
] as const;
export type WorkerRunState = (typeof WORKER_RUN_STATES)[number];

export interface WorkerRun {
  readonly workerRunId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly authorizationId: string;
  readonly actingPrincipalId: PrincipalId;
  readonly runtimeRef?: string;
  readonly state: WorkerRunState;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
}

export const EXECUTION_LEASE_STATES = [
  "active",
  "expired",
  "revoked"
] as const;
export type ExecutionLeaseState =
  (typeof EXECUTION_LEASE_STATES)[number];

export interface ExecutionLease {
  readonly leaseId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly authorizationId: string;
  readonly workerRunId: string;
  readonly actingPrincipalId: PrincipalId;
  readonly allowedCapabilities: readonly string[];
  readonly allowedEffects: readonly EffectClass[];
  readonly issuedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly controlGeneration: number;
  readonly state: ExecutionLeaseState;
}

export const CONTROL_MODES = ["running", "paused", "owner_stopped"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export interface ProjectControlState {
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly mode: ControlMode;
  readonly generation: number;
  readonly changedByPrincipalId?: PrincipalId;
  readonly changedAt?: IsoTimestamp;
  readonly reason?: string;
}

export const ORCHESTRATION_EVENT_TYPES = [
  "approval.recorded",
  "authorization.created",
  "worker.started",
  "lease.issued",
  "control.changed",
  "lease.validated"
] as const;
export type OrchestrationEventType =
  (typeof ORCHESTRATION_EVENT_TYPES)[number];

export interface OrchestrationEvent {
  readonly eventId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly type: OrchestrationEventType;
  readonly occurredAt: IsoTimestamp;
  readonly authorizationId?: string;
  readonly workerRunId?: string;
  readonly leaseId?: string;
  readonly approvedByPrincipalId?: PrincipalId;
  readonly actedByPrincipalId?: PrincipalId;
  readonly reference?: string;
}

export interface WorkerControlState {
  readonly approvals: readonly ApprovalRecord[];
  readonly authorizations: readonly WorkAuthorization[];
  readonly workerRuns: readonly WorkerRun[];
  readonly leases: readonly ExecutionLease[];
  readonly projectControls: readonly ProjectControlState[];
  readonly events: readonly OrchestrationEvent[];
}

export function emptyWorkerControlState(): WorkerControlState {
  return Object.freeze({
    approvals: Object.freeze([]),
    authorizations: Object.freeze([]),
    workerRuns: Object.freeze([]),
    leases: Object.freeze([]),
    projectControls: Object.freeze([]),
    events: Object.freeze([])
  });
}
