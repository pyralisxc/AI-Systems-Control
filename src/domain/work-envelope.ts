import type {
  AccountDomainId,
  IsoTimestamp,
  PrincipalId,
  ProjectId
} from "./shared.js";
import type { EffectClass } from "./capability.js";

export const REPOSITORY_BOUNDARIES = [
  "read_only",
  "work_branch",
  "preview",
  "main"
] as const;
export type RepositoryBoundary =
  (typeof REPOSITORY_BOUNDARIES)[number];

export const CONTINUATION_POLICIES = [
  "interactive",
  "continue_until_gate",
  "autonomous_bounded"
] as const;
export type ContinuationPolicy =
  (typeof CONTINUATION_POLICIES)[number];

export const WORK_ENVELOPE_STATES = [
  "active",
  "revoked",
  "superseded"
] as const;
export type WorkEnvelopeState =
  (typeof WORK_ENVELOPE_STATES)[number];

export interface WorkEnvelope {
  readonly envelopeId: string;
  readonly version: number;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly threadId?: string;
  readonly objectiveRef: string;
  readonly scopeFingerprint: string;
  readonly workClasses: readonly string[];
  readonly allowedEffects: readonly EffectClass[];
  readonly repositoryBoundary: RepositoryBoundary;
  readonly allowedCapabilities: readonly string[];
  readonly continuationPolicy: ContinuationPolicy;
  readonly ownerGateConditions: readonly string[];
  readonly budgetUsd?: number;
  readonly authorizationId?: string;
  readonly createdByPrincipalId: PrincipalId;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt?: IsoTimestamp;
  readonly state: WorkEnvelopeState;
}

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const AUTONOMY_GRANT_STATES = [
  "active",
  "needs_review",
  "revoked"
] as const;
export type AutonomyGrantState =
  (typeof AUTONOMY_GRANT_STATES)[number];

export interface AutonomyGrant {
  readonly grantId: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly workClass: string;
  readonly level: AutonomyLevel;
  readonly repositoryCeiling: RepositoryBoundary;
  readonly grantedByPrincipalId: PrincipalId;
  readonly grantedAt: IsoTimestamp;
  readonly evidenceBasisRefs: readonly string[];
  readonly lastProvenAt?: IsoTimestamp;
  readonly reviewAfter?: IsoTimestamp;
  readonly invalidationConditions: readonly string[];
  readonly state: AutonomyGrantState;
}

export interface ContinuationControlState {
  readonly workEnvelopes: readonly WorkEnvelope[];
  readonly autonomyGrants: readonly AutonomyGrant[];
}

export function emptyContinuationControlState(): ContinuationControlState {
  return Object.freeze({
    workEnvelopes: Object.freeze([]),
    autonomyGrants: Object.freeze([])
  });
}

export const CONTINUATION_DECISIONS = [
  "allow",
  "needs_owner",
  "blocked"
] as const;
export type ContinuationDecision =
  (typeof CONTINUATION_DECISIONS)[number];

export interface ContinuationAuthorityBasis {
  readonly envelopeId?: string;
  readonly grantId?: string;
  readonly authorizationId?: string;
  readonly autonomyLevel?: AutonomyLevel;
  readonly effectiveRepositoryCeiling?: RepositoryBoundary;
}

export interface ContinuationEvaluation {
  readonly decision: ContinuationDecision;
  readonly reason: string;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly workClass: string;
  readonly requestedEffect: EffectClass;
  readonly requestedRepositoryBoundary: RepositoryBoundary;
  readonly basis: ContinuationAuthorityBasis;
}
