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
