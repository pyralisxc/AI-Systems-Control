import type {
  AutonomyGrant,
  RelayCalibrationPolicy,
  RelayCalibrationProjection
} from "../domain/index.js";
import {
  ContinuationAuthorityService
} from "./continuation-authority-service.js";
import {
  RelayCalibrationService
} from "./relay-calibration-service.js";

export interface GrantContinueFromCalibrationInput {
  readonly representedPrincipalId: string;
  readonly reviewedByPrincipalId: string;
  readonly projectId: string;
  readonly workClass: string;
  readonly policy?: Partial<RelayCalibrationPolicy>;
  readonly grantedAt?: string;
}

export interface GrantContinueFromCalibrationResult {
  readonly changed: boolean;
  readonly projection: RelayCalibrationProjection;
  readonly grant: AutonomyGrant;
}

export class OwnerAutonomyReviewError extends Error {
  readonly code = "owner_autonomy_review_failed";

  constructor(message: string) {
    super(message);
    this.name = "OwnerAutonomyReviewError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new OwnerAutonomyReviewError(label + " is required.");
  }
  return normalized;
}

export class OwnerAutonomyReviewService {
  readonly #calibration: RelayCalibrationService;
  readonly #continuation: ContinuationAuthorityService;

  constructor(input: {
    readonly calibration: RelayCalibrationService;
    readonly continuation: ContinuationAuthorityService;
  }) {
    this.#calibration = input.calibration;
    this.#continuation = input.continuation;
  }

  async grantContinueFromCalibration(
    input: GrantContinueFromCalibrationInput
  ): Promise<GrantContinueFromCalibrationResult> {
    const representedPrincipalId = required(
      input.representedPrincipalId,
      "Represented Principal"
    );
    const reviewedByPrincipalId = required(
      input.reviewedByPrincipalId,
      "Reviewing Principal"
    );
    const projectId = required(input.projectId, "Project");
    const workClass = required(input.workClass, "Work class");

    if (reviewedByPrincipalId !== representedPrincipalId) {
      throw new OwnerAutonomyReviewError(
        "Only the represented Principal may approve autonomy from their Relay calibration."
      );
    }

    const projection = await this.#calibration.project({
      representedPrincipalId,
      projectId,
      workClass,
      ...(input.policy ? { policy: input.policy } : {})
    });

    if (projection.readiness !== "review_candidate") {
      throw new OwnerAutonomyReviewError(
        "Relay calibration is not currently ready for an owner autonomy review."
      );
    }

    const existing =
      await this.#continuation.getLatestAutonomyGrant(
        projectId,
        workClass
      );

    if (
      existing &&
      existing.state === "active" &&
      existing.level >= 2
    ) {
      return Object.freeze({
        changed: false,
        projection,
        grant: existing
      });
    }

    const grant = await this.#continuation.grantAutonomy({
      projectId,
      workClass,
      level: 2,
      repositoryCeiling: "read_only",
      grantedByPrincipalId: reviewedByPrincipalId,
      evidenceBasisRefs: [
        projection.evidenceReference,
        projection.evidenceFingerprint
      ],
      ...(projection.lastEvidenceAt
        ? { lastProvenAt: projection.lastEvidenceAt }
        : {}),
      invalidationConditions: [
        "relay_calibration_evidence_materially_changes",
        "owner_revokes_or_marks_review"
      ],
      ...(input.grantedAt
        ? { grantedAt: input.grantedAt }
        : {})
    });

    return Object.freeze({
      changed: true,
      projection,
      grant
    });
  }
}
