import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_STATUSES,
  DRIFT_STATES,
  EFFECT_CLASSES,
  assertReadCapability,
  isEffectClass,
  isReadCapability
} from "../dist/domain/index.js";
import { createSliceACapabilityCatalog } from "../dist/slice-a/index.js";

const readCapability = {
  capabilityId: "project.observe",
  name: "Observe project reality",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  effectClass: "read",
  riskClass: "none",
  ownerSystem: "Development Intelligence"
};

const mutateCapability = {
  ...readCapability,
  capabilityId: "github.issue.create",
  name: "Create GitHub issue",
  effectClass: "mutate",
  riskClass: "low"
};

test("domain constants preserve the frozen lifecycle vocabulary", () => {
  assert.deepEqual(EFFECT_CLASSES, ["read", "propose", "mutate"]);
  assert.ok(DRIFT_STATES.includes("unknown"));
  assert.ok(DRIFT_STATES.includes("stale"));
  assert.equal(ACTION_STATUSES.at(-1), "indeterminate");
});

test("read capabilities are distinguished at runtime", () => {
  assert.equal(isEffectClass("read"), true);
  assert.equal(isEffectClass("delete"), false);
  assert.equal(isReadCapability(readCapability), true);
  assert.equal(isReadCapability(mutateCapability), false);
  assert.doesNotThrow(() => assertReadCapability(readCapability));
  assert.throws(() => assertReadCapability(mutateCapability), /accepts only read capabilities/);
});

test("Slice A catalog rejects mutation capabilities", () => {
  const catalog = createSliceACapabilityCatalog([readCapability]);
  assert.equal(catalog.get("project.observe")?.effectClass, "read");
  assert.throws(
    () => createSliceACapabilityCatalog([readCapability, mutateCapability]),
    /accepts only read capabilities/
  );
});
