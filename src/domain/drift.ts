import { evaluateObservationFreshness, type FreshnessPolicy } from "./freshness.js";
import type { JsonValue } from "./shared.js";
import type { DesiredStateClaim, DriftResult, Observation } from "./state.js";

export interface DesiredStateConflict {
  readonly projectId: string;
  readonly scope: string;
  readonly key: string;
  readonly authorities: readonly string[];
  readonly claims: readonly DesiredStateClaim[];
  readonly reason: string;
}

export interface DriftEvaluation {
  readonly results: readonly DriftResult[];
  readonly conflicts: readonly DesiredStateConflict[];
}

export interface EvaluateDriftInput {
  readonly desired: readonly DesiredStateClaim[];
  readonly observations: readonly Observation[];
  readonly freshnessPolicy: FreshnessPolicy;
  readonly evaluatedAt?: string;
}

function targetId(claim: Pick<DesiredStateClaim, "projectId" | "scope" | "key">): string {
  return `${claim.projectId}\u0000${claim.scope}\u0000${claim.key}`;
}

function jsonKind(value: JsonValue): "null" | "string" | "number" | "boolean" | "array" | "object" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (jsonKind(left) !== jsonKind(right)) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]!));
  }

  if (
    left !== null &&
    right !== null &&
    !Array.isArray(left) &&
    !Array.isArray(right) &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => {
      const rightKey = rightKeys[index];
      return rightKey === key && jsonEqual(left[key]!, right[key]!);
    });
  }

  return false;
}

function newestObservation(
  claim: DesiredStateClaim,
  observations: readonly Observation[]
): Observation | undefined {
  const candidates = observations.filter(
    (observation) =>
      observation.projectId === claim.projectId &&
      observation.subject === claim.scope &&
      observation.property === claim.key
  );

  return candidates.sort((left, right) => {
    const leftTime = Date.parse(left.observedAt);
    const rightTime = Date.parse(right.observedAt);
    const safeLeft = Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime;
    const safeRight = Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime;
    return safeRight - safeLeft;
  })[0];
}

function latestClaimsByAuthority(claims: readonly DesiredStateClaim[]): readonly DesiredStateClaim[] {
  const latest = new Map<string, DesiredStateClaim>();
  for (const claim of claims) {
    const current = latest.get(claim.authority);
    if (!current || Date.parse(claim.effectiveAt) > Date.parse(current.effectiveAt)) {
      latest.set(claim.authority, claim);
    }
  }
  return [...latest.values()];
}

function findConflicts(desired: readonly DesiredStateClaim[]): DesiredStateConflict[] {
  const groups = new Map<string, DesiredStateClaim[]>();
  for (const claim of desired) {
    const key = targetId(claim);
    const bucket = groups.get(key) ?? [];
    bucket.push(claim);
    groups.set(key, bucket);
  }

  const conflicts: DesiredStateConflict[] = [];
  for (const claims of groups.values()) {
    const current = latestClaimsByAuthority(claims);
    if (current.length < 2) continue;

    const first = current[0]!;
    if (current.every((claim) => jsonEqual(first.value, claim.value))) continue;

    conflicts.push({
      projectId: first.projectId,
      scope: first.scope,
      key: first.key,
      authorities: Object.freeze(current.map((claim) => claim.authority).sort()),
      claims: Object.freeze([...current]),
      reason: "Current desired-state authorities disagree on the requested value."
    });
  }
  return conflicts;
}

function result(
  desired: DesiredStateClaim,
  state: DriftResult["state"],
  reason: string,
  observation?: Observation
): DriftResult {
  return {
    desired,
    state,
    reason,
    ...(observation ? { observation } : {})
  };
}

function evaluateClaim(
  desired: DesiredStateClaim,
  observations: readonly Observation[],
  freshnessPolicy: FreshnessPolicy,
  evaluatedAt: string | undefined
): DriftResult {
  const observed = newestObservation(desired, observations);
  if (!observed) {
    return result(desired, "unknown", "No matching observation exists for this desired-state target.");
  }

  const observedTime = Date.parse(observed.observedAt);
  const desiredTime = Date.parse(desired.effectiveAt);
  if (!Number.isNaN(observedTime) && !Number.isNaN(desiredTime) && observedTime < desiredTime) {
    return result(
      desired,
      "unknown",
      "The newest matching observation predates the effective desired state.",
      observed
    );
  }

  const freshness = evaluateObservationFreshness(
    observed,
    freshnessPolicy,
    evaluatedAt ?? new Date().toISOString()
  );
  if (freshness.state === "stale") {
    return result(desired, "stale", "The matching observation is stale.", observed);
  }
  if (freshness.state === "unknown") {
    return result(
      desired,
      "unknown",
      freshness.reason ?? "Observation freshness cannot be established.",
      observed
    );
  }

  if (observed.value === undefined) {
    return result(
      desired,
      "unknown",
      observed.unknownReason ?? "The matching observation has no known value.",
      observed
    );
  }

  if (jsonKind(desired.value) !== jsonKind(observed.value)) {
    return result(
      desired,
      "incomparable",
      `Desired value kind ${jsonKind(desired.value)} cannot be compared with observed value kind ${jsonKind(observed.value)}.`,
      observed
    );
  }

  return jsonEqual(desired.value, observed.value)
    ? result(desired, "aligned", "Desired and observed values are equal.", observed)
    : result(desired, "divergent", "Desired and observed values differ.", observed);
}

export function evaluateDesiredVsObserved(input: EvaluateDriftInput): DriftEvaluation {
  const conflicts = findConflicts(input.desired);
  const conflictedTargets = new Set(conflicts.map((conflict) => targetId(conflict)));

  const results = input.desired.map((desired) => {
    if (conflictedTargets.has(targetId(desired))) {
      return result(
        desired,
        "unknown",
        "Desired-state authorities conflict for this target; drift cannot be resolved until intent is reconciled."
      );
    }

    return evaluateClaim(
      desired,
      input.observations,
      input.freshnessPolicy,
      input.evaluatedAt
    );
  });

  return {
    results: Object.freeze(results),
    conflicts: Object.freeze(conflicts)
  };
}
