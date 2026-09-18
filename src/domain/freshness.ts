import type { IsoTimestamp } from "./shared.js";
import type { Observation } from "./state.js";

export const FRESHNESS_STATES = ["fresh", "aging", "stale", "unknown"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export interface FreshnessPolicy {
  readonly warningAfterSeconds: number;
  readonly staleAfterSeconds: number;
  readonly maxFutureSkewSeconds?: number;
}

export interface ObservationFreshness {
  readonly state: FreshnessState;
  readonly observedAt: IsoTimestamp;
  readonly evaluatedAt: IsoTimestamp;
  readonly ageSeconds?: number;
  readonly reason?: string;
}

export class FreshnessPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreshnessPolicyError";
  }
}

export function assertValidFreshnessPolicy(policy: FreshnessPolicy): void {
  if (!Number.isFinite(policy.warningAfterSeconds) || policy.warningAfterSeconds < 0) {
    throw new FreshnessPolicyError("warningAfterSeconds must be a finite non-negative number.");
  }
  if (!Number.isFinite(policy.staleAfterSeconds) || policy.staleAfterSeconds <= policy.warningAfterSeconds) {
    throw new FreshnessPolicyError("staleAfterSeconds must be finite and greater than warningAfterSeconds.");
  }
  if (
    policy.maxFutureSkewSeconds !== undefined &&
    (!Number.isFinite(policy.maxFutureSkewSeconds) || policy.maxFutureSkewSeconds < 0)
  ) {
    throw new FreshnessPolicyError("maxFutureSkewSeconds must be a finite non-negative number.");
  }
}

export function evaluateObservationFreshness(
  observation: Pick<Observation, "observedAt">,
  policy: FreshnessPolicy,
  evaluatedAt: IsoTimestamp = new Date().toISOString()
): ObservationFreshness {
  assertValidFreshnessPolicy(policy);
  const observedTime = Date.parse(observation.observedAt);
  const evaluatedTime = Date.parse(evaluatedAt);

  if (Number.isNaN(observedTime)) {
    return {
      state: "unknown",
      observedAt: observation.observedAt,
      evaluatedAt,
      reason: "Observation timestamp is invalid."
    };
  }
  if (Number.isNaN(evaluatedTime)) {
    return {
      state: "unknown",
      observedAt: observation.observedAt,
      evaluatedAt,
      reason: "Freshness evaluation timestamp is invalid."
    };
  }

  const rawAgeSeconds = (evaluatedTime - observedTime) / 1000;
  const maxFutureSkewSeconds = policy.maxFutureSkewSeconds ?? 60;
  if (rawAgeSeconds < -maxFutureSkewSeconds) {
    return {
      state: "unknown",
      observedAt: observation.observedAt,
      evaluatedAt,
      reason: `Observation timestamp is ${Math.abs(rawAgeSeconds)} seconds in the future.`
    };
  }

  const ageSeconds = Math.max(0, rawAgeSeconds);
  if (ageSeconds >= policy.staleAfterSeconds) {
    return { state: "stale", observedAt: observation.observedAt, evaluatedAt, ageSeconds };
  }
  if (ageSeconds >= policy.warningAfterSeconds) {
    return { state: "aging", observedAt: observation.observedAt, evaluatedAt, ageSeconds };
  }
  return { state: "fresh", observedAt: observation.observedAt, evaluatedAt, ageSeconds };
}
