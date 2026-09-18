import assert from "node:assert/strict";
import test from "node:test";

import {
  ObservationContractError,
  assertValidFreshnessPolicy,
  createObservation,
  evaluateObservationFreshness
} from "../dist/domain/index.js";

const baseObservation = {
  projectId: "project-1",
  subject: "repository",
  property: "revision",
  value: "abc123",
  observedAt: "2026-09-18T20:00:00.000Z",
  evidence: [{ kind: "git", locator: "https://example.test/repo" }],
  producingSystem: "development-intelligence",
  quality: "authoritative"
};

const policy = {
  warningAfterSeconds: 300,
  staleAfterSeconds: 1800,
  maxFutureSkewSeconds: 60
};

test("createObservation requires provenance for observed truth", () => {
  assert.throws(
    () => createObservation({ ...baseObservation, evidence: [] }),
    (error) => error instanceof ObservationContractError && error.code === "observation_evidence_missing"
  );
});

test("unknown observations require a reason and cannot also carry a known value", () => {
  assert.throws(
    () => createObservation({ ...baseObservation, value: undefined }),
    (error) => error instanceof ObservationContractError && error.code === "observation_unknown_reason_missing"
  );
  assert.throws(
    () => createObservation({ ...baseObservation, unknownReason: "conflict" }),
    (error) => error instanceof ObservationContractError && error.code === "observation_unknown_conflict"
  );
  assert.doesNotThrow(() => createObservation({
    ...baseObservation,
    value: undefined,
    unknownReason: "provider did not report a revision",
    quality: "unknown"
  }));
});

test("observation confidence is constrained to zero through one", () => {
  assert.throws(
    () => createObservation({ ...baseObservation, confidence: 1.01 }),
    (error) => error instanceof ObservationContractError && error.code === "observation_confidence_invalid"
  );
  assert.doesNotThrow(() => createObservation({ ...baseObservation, confidence: 0.75 }));
});

test("freshness distinguishes fresh, aging, and stale observations", () => {
  assert.equal(
    evaluateObservationFreshness(baseObservation, policy, "2026-09-18T20:04:59.000Z").state,
    "fresh"
  );
  assert.equal(
    evaluateObservationFreshness(baseObservation, policy, "2026-09-18T20:05:00.000Z").state,
    "aging"
  );
  const stale = evaluateObservationFreshness(baseObservation, policy, "2026-09-18T20:30:00.000Z");
  assert.equal(stale.state, "stale");
  assert.equal(stale.ageSeconds, 1800);
});

test("invalid and implausibly future timestamps become unknown freshness", () => {
  const invalid = evaluateObservationFreshness(
    { observedAt: "not-a-date" },
    policy,
    "2026-09-18T20:00:00.000Z"
  );
  assert.equal(invalid.state, "unknown");

  const future = evaluateObservationFreshness(
    { observedAt: "2026-09-18T20:02:00.000Z" },
    policy,
    "2026-09-18T20:00:00.000Z"
  );
  assert.equal(future.state, "unknown");
  assert.match(future.reason ?? "", /future/);
});

test("small future clock skew is tolerated as fresh", () => {
  const result = evaluateObservationFreshness(
    { observedAt: "2026-09-18T20:00:30.000Z" },
    policy,
    "2026-09-18T20:00:00.000Z"
  );
  assert.equal(result.state, "fresh");
  assert.equal(result.ageSeconds, 0);
});

test("freshness policy rejects inverted thresholds", () => {
  assert.throws(
    () => assertValidFreshnessPolicy({ warningAfterSeconds: 300, staleAfterSeconds: 300 }),
    /greater than warningAfterSeconds/
  );
});
