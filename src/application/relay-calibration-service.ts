import { createHash } from "node:crypto";

import type {
  FounderRelayRecord,
  RelayCalibrationPolicy,
  RelayCalibrationProjection
} from "../domain/index.js";
import type { ThreadStore } from "../ports/index.js";

export interface RelayCalibrationQuery {
  readonly representedPrincipalId: string;
  readonly projectId: string;
  readonly workClass: string;
  readonly policy?: Partial<RelayCalibrationPolicy>;
}

export const DEFAULT_RELAY_CALIBRATION_POLICY: RelayCalibrationPolicy =
  Object.freeze({
    minimumResponses: 20,
    minimumAcceptanceRate: 0.9,
    maximumRejectionRate: 0.05,
    maximumMeanEditRatio: 0.25
  });

const MAX_EDIT_SEQUENCE = 2048;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(label + " is required.");
  }
  return normalized;
}

function finiteRate(
  value: number,
  label: string
): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(label + " must be between 0 and 1.");
  }
  return value;
}

function normalizePolicy(
  input: Partial<RelayCalibrationPolicy> | undefined
): RelayCalibrationPolicy {
  const minimumResponses =
    input?.minimumResponses ??
    DEFAULT_RELAY_CALIBRATION_POLICY.minimumResponses;

  if (
    !Number.isInteger(minimumResponses) ||
    minimumResponses < 1
  ) {
    throw new Error(
      "minimumResponses must be a positive integer."
    );
  }

  return Object.freeze({
    minimumResponses,
    minimumAcceptanceRate: finiteRate(
      input?.minimumAcceptanceRate ??
        DEFAULT_RELAY_CALIBRATION_POLICY.minimumAcceptanceRate,
      "minimumAcceptanceRate"
    ),
    maximumRejectionRate: finiteRate(
      input?.maximumRejectionRate ??
        DEFAULT_RELAY_CALIBRATION_POLICY.maximumRejectionRate,
      "maximumRejectionRate"
    ),
    maximumMeanEditRatio: finiteRate(
      input?.maximumMeanEditRatio ??
        DEFAULT_RELAY_CALIBRATION_POLICY.maximumMeanEditRatio,
      "maximumMeanEditRatio"
    )
  });
}

function normalizedText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function editSequence(value: string): readonly string[] {
  const points = [...normalizedText(value)];
  if (points.length <= MAX_EDIT_SEQUENCE) {
    return points;
  }

  const half = MAX_EDIT_SEQUENCE / 2;
  return [
    ...points.slice(0, half),
    ...points.slice(points.length - half)
  ];
}

function levenshtein(
  leftInput: readonly string[],
  rightInput: readonly string[]
): number {
  let left = leftInput;
  let right = rightInput;

  if (left.length > right.length) {
    [left, right] = [right, left];
  }

  let previous = Array.from(
    { length: left.length + 1 },
    (_, index) => index
  );

  for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
    const current = new Array<number>(left.length + 1);
    current[0] = rightIndex;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const substitution =
        previous[leftIndex - 1]! +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const insertion = current[leftIndex - 1]! + 1;
      const deletion = previous[leftIndex]! + 1;

      current[leftIndex] = Math.min(
        substitution,
        insertion,
        deletion
      );
    }

    previous = current;
  }

  return previous[left.length]!;
}

export function normalizedRelayEditRatio(
  proposedText: string,
  finalText: string
): number {
  const fullLeft = [...normalizedText(proposedText)];
  const fullRight = [...normalizedText(finalText)];
  const maximumFullLength = Math.max(
    fullLeft.length,
    fullRight.length
  );

  if (maximumFullLength === 0) return 0;

  const sampledLeft = editSequence(proposedText);
  const sampledRight = editSequence(finalText);
  const maximumSampleLength = Math.max(
    sampledLeft.length,
    sampledRight.length
  );

  const sampleRatio =
    maximumSampleLength === 0
      ? 0
      : levenshtein(sampledLeft, sampledRight) /
        maximumSampleLength;

  const lengthRatio =
    Math.abs(fullLeft.length - fullRight.length) /
    maximumFullLength;

  return Math.min(1, Math.max(sampleRatio, lengthRatio));
}

function evidenceTimestamp(
  relay: FounderRelayRecord
): string {
  return (
    relay.feedbackAt ??
    relay.deliveredAt ??
    relay.generatedAt
  );
}

function stableEvidence(
  relay: FounderRelayRecord
) {
  return {
    relayId: relay.relayId,
    state: relay.state,
    proposedText: relay.proposedText,
    finalText: relay.finalText ?? null,
    feedbackAt: relay.feedbackAt ?? null,
    deliveredAt: relay.deliveredAt ?? null
  };
}

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundRate(
    values.reduce((sum, value) => sum + value, 0) /
      values.length
  );
}

function ratio(
  numerator: number,
  denominator: number
): number | null {
  if (denominator === 0) return null;
  return roundRate(numerator / denominator);
}

function evaluateReadiness(input: {
  readonly respondedCount: number;
  readonly acceptanceRate: number | null;
  readonly rejectionRate: number | null;
  readonly meanNormalizedEditRatio: number | null;
  readonly policy: RelayCalibrationPolicy;
}): {
  readonly readiness: RelayCalibrationProjection["readiness"];
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];

  if (input.respondedCount < input.policy.minimumResponses) {
    reasons.push(
      "Collecting explicit feedback: " +
      input.respondedCount +
      "/" +
      input.policy.minimumResponses +
      " owner responses."
    );
    return {
      readiness: "collecting",
      reasons: Object.freeze(reasons)
    };
  }

  if (
    input.acceptanceRate === null ||
    input.acceptanceRate < input.policy.minimumAcceptanceRate
  ) {
    reasons.push(
      "Acceptance rate is below the configured review threshold."
    );
  }

  if (
    input.rejectionRate === null ||
    input.rejectionRate > input.policy.maximumRejectionRate
  ) {
    reasons.push(
      "Rejection rate exceeds the configured review threshold."
    );
  }

  if (
    input.meanNormalizedEditRatio !== null &&
    input.meanNormalizedEditRatio >
      input.policy.maximumMeanEditRatio
  ) {
    reasons.push(
      "Owner edit magnitude exceeds the configured review threshold."
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      "Explicit Relay feedback satisfies the configured owner-review thresholds."
    );
    return {
      readiness: "review_candidate",
      reasons: Object.freeze(reasons)
    };
  }

  return {
    readiness: "not_ready",
    reasons: Object.freeze(reasons)
  };
}

export class RelayCalibrationService {
  readonly #store: ThreadStore;

  constructor(store: ThreadStore) {
    this.#store = store;
  }

  async project(
    query: RelayCalibrationQuery
  ): Promise<RelayCalibrationProjection> {
    const representedPrincipalId = required(
      query.representedPrincipalId,
      "Represented Principal"
    );
    const projectId = required(query.projectId, "Project");
    const workClass = required(query.workClass, "Work class");
    const policy = normalizePolicy(query.policy);

    const snapshots = await this.#store.list();
    const relays = snapshots
      .flatMap((snapshot) => snapshot.relays)
      .filter(
        (relay) =>
          relay.accountDomainId === this.#store.accountDomainId &&
          relay.representedPrincipalId === representedPrincipalId &&
          relay.projectId === projectId &&
          relay.workClass === workClass
      )
      .sort(
        (left, right) =>
          evidenceTimestamp(left).localeCompare(
            evidenceTimestamp(right)
          ) ||
          left.relayId.localeCompare(right.relayId)
      );

    const approved = relays.filter(
      (relay) => relay.state === "owner_approved"
    );
    const edited = relays.filter(
      (relay) => relay.state === "edited"
    );
    const rejected = relays.filter(
      (relay) => relay.state === "rejected"
    );
    const autoSent = relays.filter(
      (relay) => relay.state === "auto_sent"
    );
    const pending = relays.filter(
      (relay) => relay.state === "suggested"
    );

    const respondedCount =
      approved.length + edited.length + rejected.length;
    const acceptedCount =
      approved.length + edited.length;

    const editRatios = edited.map((relay) =>
      normalizedRelayEditRatio(
        relay.proposedText,
        relay.finalText ?? ""
      )
    );

    const acceptanceRate = ratio(
      acceptedCount,
      respondedCount
    );
    const editRate = ratio(
      edited.length,
      respondedCount
    );
    const rejectionRate = ratio(
      rejected.length,
      respondedCount
    );
    const meanNormalizedEditRatio = average(editRatios);

    const readiness = evaluateReadiness({
      respondedCount,
      acceptanceRate,
      rejectionRate,
      meanNormalizedEditRatio,
      policy
    });

    const canonicalEvidence = relays.map(stableEvidence);
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          accountDomainId: this.#store.accountDomainId,
          representedPrincipalId,
          projectId,
          workClass,
          evidence: canonicalEvidence
        })
      )
      .digest("hex");

    const lastEvidenceAt =
      relays.length > 0
        ? evidenceTimestamp(relays[relays.length - 1]!)
        : undefined;

    const evidenceFingerprint =
      "sha256:" + digest;
    const evidenceReference =
      "relay-calibration:" + digest.slice(0, 32);

    return Object.freeze({
      accountDomainId: this.#store.accountDomainId,
      representedPrincipalId,
      projectId,
      workClass,
      proposedCount: relays.length,
      pendingSuggestionCount: pending.length,
      respondedCount,
      approvedUnchangedCount: approved.length,
      editedCount: edited.length,
      rejectedCount: rejected.length,
      autoSentCount: autoSent.length,
      acceptanceRate,
      editRate,
      rejectionRate,
      meanNormalizedEditRatio,
      readiness: readiness.readiness,
      readinessReasons: readiness.reasons,
      ...(lastEvidenceAt ? { lastEvidenceAt } : {}),
      evidenceRelayIds: Object.freeze(
        relays.map((relay) => relay.relayId)
      ),
      evidenceFingerprint,
      evidenceReference,
      policy
    });
  }
}
