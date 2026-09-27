import type {
  AccountDomainId,
  IsoTimestamp,
  PrincipalId,
  ProjectId
} from "./shared.js";

export const RELAY_CALIBRATION_READINESS = [
  "collecting",
  "review_candidate",
  "not_ready"
] as const;
export type RelayCalibrationReadiness =
  (typeof RELAY_CALIBRATION_READINESS)[number];

export interface RelayCalibrationPolicy {
  readonly minimumResponses: number;
  readonly minimumAcceptanceRate: number;
  readonly maximumRejectionRate: number;
  readonly maximumMeanEditRatio: number;
}

export interface RelayCalibrationProjection {
  readonly accountDomainId: AccountDomainId;
  readonly representedPrincipalId: PrincipalId;
  readonly projectId: ProjectId;
  readonly workClass: string;

  readonly proposedCount: number;
  readonly pendingSuggestionCount: number;
  readonly respondedCount: number;
  readonly approvedUnchangedCount: number;
  readonly editedCount: number;
  readonly rejectedCount: number;
  readonly autoSentCount: number;

  readonly acceptanceRate: number | null;
  readonly editRate: number | null;
  readonly rejectionRate: number | null;
  readonly meanNormalizedEditRatio: number | null;

  readonly readiness: RelayCalibrationReadiness;
  readonly readinessReasons: readonly string[];
  readonly lastEvidenceAt?: IsoTimestamp;

  readonly evidenceRelayIds: readonly string[];
  readonly evidenceFingerprint: string;
  readonly evidenceReference: string;
  readonly policy: RelayCalibrationPolicy;
}
