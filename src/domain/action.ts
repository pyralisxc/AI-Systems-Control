import type {
  ActionId,
  CapabilityBindingId,
  CapabilityId,
  IsoTimestamp,
  JsonValue,
  ProjectId,
  WorkspaceId
} from "./shared.js";

export const ACTION_STATUSES = [
  "draft",
  "proposed",
  "policy_checked",
  "awaiting_authorization",
  "authorized",
  "executing",
  "effect_reported",
  "reconciling",
  "verified",
  "failed",
  "cancelled",
  "indeterminate"
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface Action {
  readonly actionId: ActionId;
  readonly projectId: ProjectId;
  readonly workspaceId?: WorkspaceId;
  readonly capabilityId: CapabilityId;
  readonly bindingId: CapabilityBindingId;
  readonly normalizedIntent: JsonValue;
  readonly requestedEffect: JsonValue;
  readonly proposer: string;
  readonly status: ActionStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly executionCorrelationId?: string;
}

export const POLICY_OUTCOMES = ["allow", "deny", "require_authorization"] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export interface PolicyDecision {
  readonly actionId: ActionId;
  readonly outcome: PolicyOutcome;
  readonly policyIds: readonly string[];
  readonly inputs: JsonValue;
  readonly explanation: string;
  readonly requiredApprover?: string;
  readonly requiredPermissionChange?: string;
  readonly decidedAt: IsoTimestamp;
}

export const RECONCILIATION_STATUSES = [
  "pending",
  "verified",
  "divergent",
  "indeterminate"
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface EffectReceipt {
  readonly actionId: ActionId;
  readonly executor: string;
  readonly provider: string;
  readonly requestFingerprint: string;
  readonly correlationId?: string;
  readonly reportedResult: JsonValue;
  readonly providerReferences?: readonly string[];
  readonly reportedAt: IsoTimestamp;
  readonly reconciliationStatus: ReconciliationStatus;
}
