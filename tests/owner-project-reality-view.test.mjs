import assert from "node:assert/strict";
import test from "node:test";

import {
  createObservation
} from "../dist/domain/index.js";
import {
  buildOwnerProjectRealityView,
  createSliceACapabilityCatalog
} from "../dist/slice-a/index.js";

const project = {
  projectId: "project-1",
  name: "Project One",
  references: [
    { kind: "github_repository", value: "owner/repo", canonical: true }
  ],
  createdAt: "2026-09-18T20:00:00.000Z",
  status: "active"
};

const desiredClaim = {
  projectId: "project-1",
  scope: "repository",
  key: "default_ref",
  value: "main",
  authority: "owner",
  effectiveAt: "2026-09-18T20:00:00.000Z"
};

const workspace = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  selectedHost: "github",
  desiredStateOverlay: [desiredClaim]
};

const observeCapability = {
  capabilityId: "project.observe",
  name: "Observe project",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  effectClass: "read",
  riskClass: "none",
  ownerSystem: "development-intelligence"
};

const coverageCapability = {
  ...observeCapability,
  capabilityId: "project.coverage",
  name: "Read project coverage"
};

const observedDefaultRef = createObservation({
  projectId: "project-1",
  subject: "repository",
  property: "default_ref",
  value: "main",
  observedAt: "2026-09-18T20:05:00.000Z",
  evidence: [{ kind: "git", locator: "https://github.com/owner/repo" }],
  producingSystem: "development-intelligence",
  quality: "authoritative"
});

const inferredCurrentness = createObservation({
  projectId: "project-1",
  subject: "development_intelligence",
  property: "currentness",
  value: { sourceCurrent: true },
  observedAt: "2026-09-18T20:04:00.000Z",
  evidence: [{ kind: "development-intelligence-tool", locator: "development-intelligence://owner/repo/project_status" }],
  producingSystem: "development-intelligence",
  quality: "derived"
});

const unknownRevision = createObservation({
  projectId: "project-1",
  subject: "source:runtime",
  property: "revision",
  value: undefined,
  unknownReason: "runtime source did not report a revision",
  observedAt: "2026-09-18T20:03:00.000Z",
  evidence: [{ kind: "runtime-http", locator: "https://example.test" }],
  producingSystem: "development-intelligence",
  quality: "unknown"
});

function composition() {
  const capabilityCatalog = createSliceACapabilityCatalog([
    observeCapability,
    coverageCapability
  ]);

  return {
    capabilityCatalog,
    realityProvider: {
      providerId: "development-intelligence",
      async observeProject(request) {
        assert.equal(request.host, "github");
        return {
          projectId: project.projectId,
          availability: "partial",
          observations: [observedDefaultRef, inferredCurrentness, unknownRevision],
          problems: [{
            code: "runtime_partial",
            message: "runtime source incomplete",
            retryable: true
          }]
        };
      }
    },
    bindingResolver: {
      async resolveReadBindings(request) {
        return request.capabilities.map((capability) => ({
          bindingId: `binding:${capability.capabilityId}`,
          capabilityId: capability.capabilityId,
          projectId: project.projectId,
          workspaceId: workspace.workspaceId,
          host: "github",
          provider: "development-intelligence",
          adapter: "di-mcp",
          permissionState: capability.capabilityId === "project.coverage" ? "blocked" : "granted",
          availabilityState: capability.capabilityId === "project.coverage" ? "permission_blocked" : "available",
          ...(capability.capabilityId === "project.coverage"
            ? { reason: "coverage permission unavailable" }
            : {})
        }));
      }
    }
  };
}

test("owner view composes project identity, truth, drift, freshness, and capabilities", async () => {
  const view = await buildOwnerProjectRealityView({
    composition: composition(),
    project,
    workspace,
    freshnessPolicy: { warningAfterSeconds: 300, staleAfterSeconds: 1800 },
    evaluatedAt: "2026-09-18T20:10:00.000Z"
  });

  assert.equal(view.project.githubRepository, "owner/repo");
  assert.equal(view.realityAvailability, "partial");
  assert.equal(view.problems[0]?.code, "runtime_partial");

  assert.equal(view.truth.observed.length, 2);
  assert.equal(view.truth.inferred.length, 1);
  assert.equal(view.truth.desired.length, 1);
  assert.equal(view.truth.desired[0]?.drift.state, "aligned");

  const repository = view.truth.observed.find(
    (item) => item.observation.property === "default_ref"
  );
  assert.equal(repository?.freshness.state, "aging");
  assert.equal(repository?.observation.evidence[0]?.kind, "git");

  const unknown = view.truth.observed.find(
    (item) => item.observation.subject === "source:runtime"
  );
  assert.equal(unknown?.observation.value, undefined);
  assert.match(unknown?.observation.unknownReason ?? "", /did not report/);

  const coverage = view.capabilities.find(
    (item) => item.capability.capabilityId === "project.coverage"
  );
  assert.equal(coverage?.bindings[0]?.availabilityState, "permission_blocked");
  assert.equal(coverage?.bindings[0]?.reason, "coverage permission unavailable");

  assert.deepEqual(view.truth.proposed, []);
  assert.deepEqual(view.truth.reported, []);
  assert.deepEqual(view.truth.verified, []);
});

test("explicit desired-state input overrides workspace overlay", async () => {
  const view = await buildOwnerProjectRealityView({
    composition: composition(),
    project,
    workspace,
    desiredState: [{ ...desiredClaim, value: "develop" }],
    freshnessPolicy: { warningAfterSeconds: 300, staleAfterSeconds: 1800 },
    evaluatedAt: "2026-09-18T20:10:00.000Z"
  });

  assert.equal(view.truth.desired[0]?.drift.state, "divergent");
});

test("owner view rejects a workspace belonging to another project", async () => {
  await assert.rejects(
    () => buildOwnerProjectRealityView({
      composition: composition(),
      project,
      workspace: { ...workspace, projectId: "other-project" },
      freshnessPolicy: { warningAfterSeconds: 300, staleAfterSeconds: 1800 },
      evaluatedAt: "2026-09-18T20:10:00.000Z"
    }),
    /belongs to project/
  );
});
