import type { IsoTimestamp, JsonValue, ProjectId } from "./shared.js";

export const OBSERVATION_QUALITIES = ["authoritative", "derived", "partial", "unknown"] as const;
export type ObservationQuality = (typeof OBSERVATION_QUALITIES)[number];

export interface EvidenceReference {
  readonly kind: string;
  readonly locator: string;
  readonly label?: string;
}

export interface Observation {
  readonly projectId: ProjectId;
  readonly subject: string;
  readonly property: string;
  readonly value: JsonValue | undefined;
  readonly unknownReason?: string;
  readonly observedAt: IsoTimestamp;
  readonly evidence: readonly EvidenceReference[];
  readonly producingSystem: string;
  readonly quality: ObservationQuality;
  readonly confidence?: number;
}

export class ObservationContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ObservationContractError";
    this.code = code;
  }
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function assertValidObservation(observation: Observation): void {
  if (!nonEmpty(observation.projectId)) {
    throw new ObservationContractError("observation_project_missing", "Observation projectId is required.");
  }
  if (!nonEmpty(observation.subject) || !nonEmpty(observation.property)) {
    throw new ObservationContractError(
      "observation_identity_missing",
      "Observation subject and property are required."
    );
  }
  if (!nonEmpty(observation.producingSystem)) {
    throw new ObservationContractError(
      "observation_producer_missing",
      "Observation producingSystem is required."
    );
  }
  if (Number.isNaN(Date.parse(observation.observedAt))) {
    throw new ObservationContractError(
      "observation_timestamp_invalid",
      `Observation observedAt is not a valid timestamp: ${observation.observedAt}`
    );
  }
  if (observation.evidence.length === 0) {
    throw new ObservationContractError(
      "observation_evidence_missing",
      "Observed truth requires at least one evidence reference."
    );
  }
  for (const item of observation.evidence) {
    if (!nonEmpty(item.kind) || !nonEmpty(item.locator)) {
      throw new ObservationContractError(
        "observation_evidence_invalid",
        "Evidence references require non-empty kind and locator values."
      );
    }
  }
  if (observation.value === undefined && !nonEmpty(observation.unknownReason ?? "")) {
    throw new ObservationContractError(
      "observation_unknown_reason_missing",
      "Unknown observations require an explicit unknownReason."
    );
  }
  if (observation.value !== undefined && observation.unknownReason !== undefined) {
    throw new ObservationContractError(
      "observation_unknown_conflict",
      "Known observations cannot also carry unknownReason."
    );
  }
  if (
    observation.confidence !== undefined &&
    (observation.confidence < 0 || observation.confidence > 1 || !Number.isFinite(observation.confidence))
  ) {
    throw new ObservationContractError(
      "observation_confidence_invalid",
      "Observation confidence must be a finite value between 0 and 1."
    );
  }
}

export function createObservation(observation: Observation): Observation {
  assertValidObservation(observation);
  return Object.freeze({
    ...observation,
    evidence: Object.freeze([...observation.evidence])
  });
}

export interface DesiredStateClaim {
  readonly projectId: ProjectId;
  readonly scope: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly authority: string;
  readonly effectiveAt: IsoTimestamp;
  readonly policyOwner?: string;
}

export const DRIFT_STATES = [
  "aligned",
  "divergent",
  "unknown",
  "incomparable",
  "stale"
] as const;
export type DriftState = (typeof DRIFT_STATES)[number];

export interface DriftResult {
  readonly desired: DesiredStateClaim;
  readonly observation?: Observation;
  readonly state: DriftState;
  readonly reason?: string;
}
