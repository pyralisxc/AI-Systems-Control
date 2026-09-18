import assert from "node:assert/strict";
import test from "node:test";

import {
  DevelopmentIntelligenceProjectRealityProvider,
  resolveDevelopmentIntelligenceProject
} from "../dist/adapters/development-intelligence/index.js";

const project = {
  projectId: "cardforge",
  name: "CardForge",
  references: [{ kind: "github_repository", value: "pyralisxc/CardForge", canonical: true }],
  createdAt: "2026-09-18T00:00:00.000Z",
  status: "active"
};

function fullClient(overrides = {}) {
  return {
    async projectStatus() {
      return {
        project: "pyralisxc/CardForge",
        repository: "https://github.com/pyralisxc/CardForge.git",
        ref: "HEAD",
        upstreamSha: "abc123",
        upstreamError: null,
        graphError: null,
        graph: {
          project: "pyralisxc/CardForge",
          repository: "https://github.com/pyralisxc/CardForge.git",
          ref: "HEAD",
          revision: "abc123",
          analyzerVersion: "3.0.0",
          currentness: {
            acceptedSemanticCurrent: true,
            sourceCurrent: true,
            topologyCurrent: true,
            evidenceCurrent: true,
            analyzerCurrent: true,
            schemaSupported: true,
            integrityCurrent: true,
            checkpointError: null
          },
          accepted: { graphId: "accepted", current: true, nodes: 5, edges: 4 },
          working: { graphId: "working", nodes: 8, edges: 7, evidenceRecords: 6 }
        }
      };
    },
    async projectOverview() {
      return {
        project: "pyralisxc/CardForge",
        graphId: "working",
        revision: "abc123",
        summary: "CardForge overview",
        counts: { nodes: 8, edges: 7, evidence: 6 },
        coverage: {
          trackedFiles: 10,
          eligibleFiles: 8,
          analyzedFiles: 8,
          completeFiles: 8,
          partialFiles: 0,
          unsupportedFiles: 0,
          skippedFiles: 0,
          failedFiles: 0
        }
      };
    },
    async listSources() {
      return {
        project: "pyralisxc/CardForge",
        graphId: "working",
        revision: "abc123",
        observedGraphSources: [
          {
            id: "git",
            kind: "git",
            locator: "https://github.com/pyralisxc/CardForge.git",
            revision: "abc123",
            observedAt: "2026-09-18T20:00:00.000Z",
            available: true
          }
        ],
        unavailableSourceIds: []
      };
    },
    ...overrides
  };
}

test("resolves explicit DI project reference before GitHub fallback", () => {
  assert.equal(resolveDevelopmentIntelligenceProject(project), "pyralisxc/CardForge");
  assert.equal(
    resolveDevelopmentIntelligenceProject({
      ...project,
      references: [
        { kind: "development_intelligence_project", value: "registry-cardforge" },
        ...project.references
      ]
    }),
    "registry-cardforge"
  );
});

test("normalizes complete DI reality as available with provenance", async () => {
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: fullClient(),
    now: () => "2026-09-18T21:00:00.000Z"
  });

  const snapshot = await provider.observeProject({ project });
  assert.equal(snapshot.availability, "available");
  assert.deepEqual(snapshot.problems, []);
  assert.equal(snapshot.observations.find((item) => item.property === "revision")?.value, "abc123");
  assert.equal(snapshot.observations.find((item) => item.property === "graph_id")?.value, "working");
  const source = snapshot.observations.find((item) => item.subject === "source:git" && item.property === "available");
  assert.equal(source?.observedAt, "2026-09-18T20:00:00.000Z");
  assert.equal(source?.evidence[0]?.kind, "git");
});

test("preserves partial graph failure as unknown instead of fabricating reality", async () => {
  const client = fullClient({
    async projectStatus() {
      return {
        project: "pyralisxc/CardForge",
        repository: "https://github.com/pyralisxc/CardForge.git",
        ref: "HEAD",
        upstreamSha: "abc123",
        upstreamError: null,
        graph: null,
        graphError: "graph build failed"
      };
    }
  });
  const provider = new DevelopmentIntelligenceProjectRealityProvider({ client });
  const snapshot = await provider.observeProject({ project });

  assert.equal(snapshot.availability, "partial");
  const graph = snapshot.observations.find(
    (item) => item.subject === "development_intelligence" && item.property === "graph"
  );
  assert.equal(graph?.value, undefined);
  assert.equal(graph?.quality, "unknown");
  assert.match(graph?.unknownReason ?? "", /graph build failed/);
});

test("incomplete coverage and unavailable sources degrade availability to partial", async () => {
  const client = fullClient({
    async projectOverview() {
      return {
        project: "pyralisxc/CardForge",
        graphId: "working",
        coverage: { completeFiles: 7, partialFiles: 1, skippedFiles: 0, failedFiles: 0 }
      };
    },
    async listSources() {
      return {
        project: "pyralisxc/CardForge",
        observedGraphSources: [
          {
            id: "runtime",
            kind: "runtime-http",
            locator: "https://example.invalid",
            revision: null,
            observedAt: "2026-09-18T20:00:00.000Z",
            available: false,
            error: "timeout"
          }
        ],
        unavailableSourceIds: ["runtime"]
      };
    }
  });
  const provider = new DevelopmentIntelligenceProjectRealityProvider({ client });
  const snapshot = await provider.observeProject({ project });

  assert.equal(snapshot.availability, "partial");
  assert.ok(snapshot.problems.some((item) => item.code === "development_intelligence_coverage_incomplete"));
  assert.ok(snapshot.problems.some((item) => item.code === "development_intelligence_sources_unavailable"));
});

test("total DI transport failure is unavailable with explicit problems", async () => {
  const unavailable = async () => {
    throw new Error("DI offline");
  };
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: {
      projectStatus: unavailable,
      projectOverview: unavailable,
      listSources: unavailable
    }
  });
  const snapshot = await provider.observeProject({ project });

  assert.equal(snapshot.availability, "unavailable");
  assert.equal(snapshot.observations.length, 0);
  assert.equal(snapshot.problems.length, 3);
});

test("missing DI/GitHub reference is non-retryable and does not call the client", async () => {
  let called = false;
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: {
      async projectStatus() { called = true; throw new Error("unexpected"); },
      async projectOverview() { called = true; throw new Error("unexpected"); },
      async listSources() { called = true; throw new Error("unexpected"); }
    }
  });
  const snapshot = await provider.observeProject({
    project: { ...project, references: [] }
  });

  assert.equal(snapshot.availability, "unavailable");
  assert.equal(snapshot.problems[0]?.retryable, false);
  assert.equal(called, false);
});
