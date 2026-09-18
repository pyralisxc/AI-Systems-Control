import assert from "node:assert/strict";
import test from "node:test";

import {
  DevelopmentIntelligenceMcpHttpClient,
  DevelopmentIntelligenceReadBindingCandidateSource,
  DevelopmentIntelligenceTransportError
} from "../dist/adapters/development-intelligence/index.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function toolResult(id, structuredContent) {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent
    }
  });
}

test("MCP HTTP client initializes once and calls DI public tools with bearer auth", async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });

    if (body.method === "initialize") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Development Intelligence", version: "2.9.0" }
        }
      });
    }
    if (body.method === "tools/call" && body.params.name === "project_status") {
      return toolResult(body.id, {
        project: "owner/repo",
        repository: "https://github.com/owner/repo.git",
        ref: "HEAD",
        upstreamSha: "abc",
        upstreamError: null,
        graph: null,
        graphError: "not built"
      });
    }
    if (body.method === "tools/call" && body.params.name === "project_overview") {
      return toolResult(body.id, { project: "owner/repo", graphId: "graph" });
    }
    if (body.method === "tools/call" && body.params.name === "list_sources") {
      return toolResult(body.id, { project: "owner/repo", observedGraphSources: [] });
    }
    if (body.method === "ping") {
      return jsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
    }
    throw new Error(`Unexpected request: ${body.method}`);
  };

  const client = new DevelopmentIntelligenceMcpHttpClient({
    baseUrl: "https://di.example/workbench",
    token: "secret",
    fetchImpl: fakeFetch
  });

  const status = await client.projectStatus({ project: "owner/repo" });
  await client.projectOverview({ project: "owner/repo", ref: "branch:main" });
  await client.listSources({ project: "owner/repo" });
  await client.probe();

  assert.equal(status.project, "owner/repo");
  assert.equal(requests.filter((request) => request.body.method === "initialize").length, 1);
  assert.ok(requests.every((request) => request.url === "https://di.example/mcp"));
  assert.ok(requests.every((request) => request.init.headers.authorization === "Bearer secret"));

  const overview = requests.find(
    (request) => request.body.method === "tools/call" &&
      request.body.params.name === "project_overview"
  );
  assert.equal(overview.body.params.arguments.ref, "branch:main");
});

test("HTTP authorization failures surface typed transport status", async () => {
  const client = new DevelopmentIntelligenceMcpHttpClient({
    baseUrl: "https://di.example",
    fetchImpl: async () => new Response("unauthorized", { status: 401 })
  });

  await assert.rejects(
    () => client.probe(),
    (error) =>
      error instanceof DevelopmentIntelligenceTransportError &&
      error.status === 401
  );
});

test("DI binding source distinguishes permission failure from adapter outage", async () => {
  const capability = {
    capabilityId: "project.observe",
    name: "Observe project",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    effectClass: "read",
    riskClass: "none",
    ownerSystem: "development-intelligence"
  };
  const request = {
    project: {
      projectId: "project-1",
      name: "Project",
      references: [{ kind: "github_repository", value: "owner/repo" }],
      createdAt: "2026-09-18T20:00:00.000Z",
      status: "active"
    },
    capability
  };

  const blocked = new DevelopmentIntelligenceReadBindingCandidateSource({
    probe: {
      async probe() {
        throw new DevelopmentIntelligenceTransportError("unauthorized", { status: 401 });
      }
    }
  });
  const blockedCandidates = await blocked.listCandidates(request);
  assert.equal(blockedCandidates[0]?.permissionState, "blocked");
  assert.equal(blockedCandidates[0]?.adapterAvailable, true);

  const offline = new DevelopmentIntelligenceReadBindingCandidateSource({
    probe: {
      async probe() {
        throw new DevelopmentIntelligenceTransportError("network unavailable");
      }
    }
  });
  const offlineCandidates = await offline.listCandidates(request);
  assert.equal(offlineCandidates[0]?.permissionState, "unknown");
  assert.equal(offlineCandidates[0]?.adapterAvailable, false);
});
