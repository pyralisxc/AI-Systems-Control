import assert from "node:assert/strict";
import test from "node:test";

import {
  HostAwareReadCapabilityBindingResolver,
  InMemoryProjectRegistry
} from "../dist/application/index.js";
import {
  DevelopmentIntelligenceMcpHttpClient,
  DevelopmentIntelligenceProjectRealityProvider,
  DevelopmentIntelligenceReadBindingCandidateSource
} from "../dist/adapters/development-intelligence/index.js";
import {
  buildOwnerProjectRealityView,
  createSliceACapabilityCatalog
} from "../dist/slice-a/index.js";

function rpc(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("concrete MCP transport composes through the complete Slice A owner path", async () => {
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return rpc({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Development Intelligence", version: "2.9.0" }
        }
      });
    }
    if (body.method === "ping") {
      return rpc({ jsonrpc: "2.0", id: body.id, result: {} });
    }

    const name = body.params.name;
    let structuredContent;
    if (name === "project_status") {
      structuredContent = {
        project: "owner/repo",
        repository: "https://github.com/owner/repo.git",
        ref: "HEAD",
        upstreamSha: "abc123",
        upstreamError: null,
        graphError: null,
        graph: {
          revision: "abc123",
          analyzerVersion: "2.9.0",
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
          accepted: null,
          working: {
            graphId: "graph-1",
            nodes: 10,
            edges: 8,
            evidenceRecords: 5
          }
        }
      };
    } else if (name === "project_overview") {
      structuredContent = {
        project: "owner/repo",
        graphId: "graph-1",
        revision: "abc123",
        summary: "Repository overview",
        counts: { nodes: 10, edges: 8, evidence: 5 },
        coverage: {
          trackedFiles: 5,
          eligibleFiles: 5,
          analyzedFiles: 5,
          completeFiles: 5,
          partialFiles: 0,
          unsupportedFiles: 0,
          skippedFiles: 0,
          failedFiles: 0
        }
      };
    } else if (name === "list_sources") {
      structuredContent = {
        project: "owner/repo",
        graphId: "graph-1",
        revision: "abc123",
        observedGraphSources: [{
          id: "git",
          kind: "git",
          locator: "https://github.com/owner/repo.git",
          revision: "abc123",
          observedAt: "2026-09-18T20:09:00.000Z",
          available: true
        }],
        unavailableSourceIds: []
      };
    } else {
      throw new Error(`Unexpected DI tool: ${name}`);
    }

    return rpc({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent
      }
    });
  };

  const registry = new InMemoryProjectRegistry();
  const project = registry.resolveOrRegisterGithubProject({
    repository: "owner/repo",
    createdAt: "2026-09-18T20:00:00.000Z"
  });
  const workspace = {
    workspaceId: "workspace-live",
    projectId: project.projectId,
    selectedHost: "development-intelligence",
    desiredStateOverlay: [{
      projectId: project.projectId,
      scope: "repository",
      key: "default_ref",
      value: "HEAD",
      authority: "owner",
      effectiveAt: "2026-09-18T20:00:00.000Z"
    }]
  };

  const client = new DevelopmentIntelligenceMcpHttpClient({
    baseUrl: "https://di.example",
    fetchImpl: fakeFetch
  });
  const realityProvider = new DevelopmentIntelligenceProjectRealityProvider({
    client,
    now: () => "2026-09-18T20:09:30.000Z"
  });
  const bindingResolver = new HostAwareReadCapabilityBindingResolver(
    new DevelopmentIntelligenceReadBindingCandidateSource({ probe: client })
  );
  const capabilityCatalog = createSliceACapabilityCatalog([{
    capabilityId: "project.observe",
    name: "Observe project",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    effectClass: "read",
    riskClass: "none",
    ownerSystem: "development-intelligence"
  }]);

  const view = await buildOwnerProjectRealityView({
    composition: { realityProvider, bindingResolver, capabilityCatalog },
    project,
    workspace,
    freshnessPolicy: { warningAfterSeconds: 300, staleAfterSeconds: 1800 },
    evaluatedAt: "2026-09-18T20:10:00.000Z"
  });

  assert.equal(view.project.githubRepository, "owner/repo");
  assert.equal(view.realityAvailability, "available");
  assert.equal(view.capabilities[0]?.bindings[0]?.availabilityState, "available");
  assert.equal(view.truth.desired[0]?.drift.state, "aligned");
  assert.ok(view.truth.observed.some((item) => item.observation.property === "revision"));
  assert.ok(view.truth.inferred.some((item) => item.observation.property === "currentness"));
});
