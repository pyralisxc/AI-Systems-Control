import assert from "node:assert/strict";
import test from "node:test";

import {
  DevelopmentIntelligenceProjectRealityProvider
} from "../dist/adapters/development-intelligence/index.js";

const baseProject = {
  projectId: "project-1",
  name: "Project One",
  references: [{ kind: "github_repository", value: "owner/repo" }],
  createdAt: "2026-09-18T20:00:00.000Z",
  status: "active"
};

function client(calls) {
  return {
    async projectStatus() {
      return {
        project: "owner/repo",
        repository: "https://github.com/owner/repo.git",
        ref: "HEAD",
        upstreamSha: "abc",
        upstreamError: null,
        graphError: null,
        graph: {
          revision: "abc",
          analyzerVersion: "1",
          currentness: {},
          accepted: null,
          working: {}
        }
      };
    },
    async projectOverview(input) {
      calls.push(["overview", input.ref]);
      return {
        project: "owner/repo",
        graphId: "graph",
        coverage: {
          completeFiles: 1,
          partialFiles: 0,
          skippedFiles: 0,
          failedFiles: 0
        }
      };
    },
    async listSources(input) {
      calls.push(["sources", input.ref]);
      return {
        project: "owner/repo",
        observedGraphSources: [],
        unavailableSourceIds: []
      };
    }
  };
}

test("workspace host context is never reused as a DI revision selector", async () => {
  const calls = [];
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: client(calls),
    now: () => "2026-09-18T20:00:00.000Z"
  });

  await provider.observeProject({ project: baseProject, host: "github" });
  assert.deepEqual(calls, [["overview", undefined], ["sources", undefined]]);
});

test("an explicit development_intelligence_ref controls DI revision selection", async () => {
  const calls = [];
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: client(calls),
    now: () => "2026-09-18T20:00:00.000Z"
  });

  await provider.observeProject({
    project: {
      ...baseProject,
      references: [
        ...baseProject.references,
        { kind: "development_intelligence_ref", value: "branch:main" }
      ]
    },
    host: "github"
  });

  assert.deepEqual(calls, [["overview", "branch:main"], ["sources", "branch:main"]]);
});
