import assert from "node:assert/strict";
import test from "node:test";

import {
  createObservation,
  evaluateDesiredVsObserved
} from "../dist/domain/index.js";

const policy = {
  warningAfterSeconds: 300,
  staleAfterSeconds: 1800,
  maxFutureSkewSeconds: 60
};

const evaluatedAt = "2026-09-18T20:10:00.000Z";

function desired(value, overrides = {}) {
  return {
    projectId: "project-1",
    scope: "repository",
    key: "default_ref",
    value,
    authority: "owner",
    effectiveAt: "2026-09-18T19:00:00.000Z",
    ...overrides
  };
}

function observed(value, overrides = {}) {
  return createObservation({
    projectId: "project-1",
    subject: "repository",
    property: "default_ref",
    value,
    observedAt: "2026-09-18T20:05:00.000Z",
    evidence: [{ kind: "git", locator: "https://example.test/repo" }],
    producingSystem: "development-intelligence",
    quality: value === undefined ? "unknown" : "authoritative",
    ...(value === undefined ? { unknownReason: "provider did not report a value" } : {}),
    ...overrides
  });
}

function evaluate(desiredClaims, observations) {
  return evaluateDesiredVsObserved({
    desired: desiredClaims,
    observations,
    freshnessPolicy: policy,
    evaluatedAt
  });
}

test("C01 equal comparable values resolve aligned", () => {
  const output = evaluate([desired("main")], [observed("main")]);
  assert.equal(output.results[0]?.state, "aligned");
});

test("C02 unequal comparable values resolve divergent", () => {
  const output = evaluate([desired("main")], [observed("develop")]);
  assert.equal(output.results[0]?.state, "divergent");
});

test("C03 missing observation resolves unknown", () => {
  const output = evaluate([desired("main")], []);
  assert.equal(output.results[0]?.state, "unknown");
  assert.match(output.results[0]?.reason ?? "", /No matching observation/);
});

test("C04 stale observation resolves stale rather than aligned", () => {
  const output = evaluate(
    [desired("main")],
    [observed("main", { observedAt: "2026-09-18T19:30:00.000Z" })]
  );
  assert.equal(output.results[0]?.state, "stale");
});

test("C05 different JSON value kinds resolve incomparable", () => {
  const output = evaluate([desired({ branch: "main" })], [observed("main")]);
  assert.equal(output.results[0]?.state, "incomparable");
});

test("C06 desired state preserves authority and source identity", () => {
  const claim = desired("main", { authority: "founder-policy" });
  const output = evaluate([claim], [observed("main")]);
  assert.equal(output.results[0]?.desired.authority, "founder-policy");
});

test("C07 conflicting current desired-state authorities are surfaced explicitly", () => {
  const output = evaluate(
    [
      desired("main", { authority: "founder" }),
      desired("develop", { authority: "deployment-policy" })
    ],
    [observed("main")]
  );

  assert.equal(output.conflicts.length, 1);
  assert.deepEqual(output.conflicts[0]?.authorities, ["deployment-policy", "founder"]);
  assert.ok(output.results.every((item) => item.state === "unknown"));
  assert.ok(output.results.every((item) => /authorities conflict/.test(item.reason ?? "")));
});

test("identical desired values from multiple authorities do not create a conflict", () => {
  const output = evaluate(
    [
      desired("main", { authority: "founder" }),
      desired("main", { authority: "deployment-policy" })
    ],
    [observed("main")]
  );

  assert.equal(output.conflicts.length, 0);
  assert.ok(output.results.every((item) => item.state === "aligned"));
});

test("newest matching observation wins deterministically", () => {
  const output = evaluate(
    [desired("main")],
    [
      observed("develop", { observedAt: "2026-09-18T20:00:00.000Z" }),
      observed("main", { observedAt: "2026-09-18T20:05:00.000Z" })
    ]
  );
  assert.equal(output.results[0]?.state, "aligned");
});

test("observation predating desired state cannot establish alignment", () => {
  const output = evaluate(
    [desired("main", { effectiveAt: "2026-09-18T20:06:00.000Z" })],
    [observed("main", { observedAt: "2026-09-18T20:05:00.000Z" })]
  );
  assert.equal(output.results[0]?.state, "unknown");
  assert.match(output.results[0]?.reason ?? "", /predates/);
});

test("unknown observation value remains unknown", () => {
  const output = evaluate([desired("main")], [observed(undefined)]);
  assert.equal(output.results[0]?.state, "unknown");
});

test("unknown freshness can never report aligned", () => {
  const output = evaluate(
    [desired("main")],
    [observed("main", { observedAt: "2026-09-18T20:12:00.000Z" })]
  );
  assert.equal(output.results[0]?.state, "unknown");
});

test("C08 a fresh reconciliation can move divergent state to aligned", () => {
  const claim = desired("main");
  const before = evaluate(
    [claim],
    [observed("develop", { observedAt: "2026-09-18T20:01:00.000Z" })]
  );
  const after = evaluate(
    [claim],
    [
      observed("develop", { observedAt: "2026-09-18T20:01:00.000Z" }),
      observed("main", { observedAt: "2026-09-18T20:05:00.000Z" })
    ]
  );

  assert.equal(before.results[0]?.state, "divergent");
  assert.equal(after.results[0]?.state, "aligned");
});
