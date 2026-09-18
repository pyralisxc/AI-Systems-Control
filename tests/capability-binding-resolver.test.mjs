import assert from "node:assert/strict";
import test from "node:test";

import { HostAwareReadCapabilityBindingResolver } from "../dist/application/index.js";

const project = {
  projectId: "project-1",
  name: "Project One",
  references: [{ kind: "github_repository", value: "owner/repo" }],
  createdAt: "2026-09-18T20:00:00.000Z",
  status: "active"
};

const capability = {
  capabilityId: "project.observe",
  name: "Observe project",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  effectClass: "read",
  riskClass: "none",
  ownerSystem: "development-intelligence"
};

function workspace(host, id = `workspace-${host}`) {
  return {
    workspaceId: id,
    projectId: project.projectId,
    selectedHost: host
  };
}

function candidate(overrides = {}) {
  return {
    bindingId: "binding-github",
    capabilityId: capability.capabilityId,
    host: "github",
    provider: "development-intelligence",
    adapter: "di-mcp",
    permissionState: "granted",
    supported: true,
    adapterAvailable: true,
    ...overrides
  };
}

function sourceFrom(getCandidates) {
  return {
    async listCandidates(request) {
      return getCandidates(request);
    }
  };
}

test("B01 two workspaces can resolve different hosts without changing the project", async () => {
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [
      candidate({ bindingId: "github", host: "github" }),
      candidate({ bindingId: "local", host: "local", adapter: "di-local" })
    ])
  );

  const github = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });
  const local = await resolver.resolveReadBindings({
    project,
    workspace: workspace("local"),
    capabilities: [capability]
  });

  assert.equal(github[0]?.host, "github");
  assert.equal(local[0]?.host, "local");
  assert.equal(project.projectId, "project-1");
});

test("B02 known capability unsupported on selected host is unavailable with reason", async () => {
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [candidate({ host: "local" })])
  );
  const result = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.equal(result[0]?.availabilityState, "unavailable");
  assert.match(result[0]?.reason ?? "", /selected host github/);
});

test("B03 supported binding with missing permission is permission-blocked", async () => {
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [candidate({ permissionState: "blocked", reason: "read scope missing" })])
  );
  const result = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.equal(result[0]?.availabilityState, "permission_blocked");
  assert.equal(result[0]?.reason, "read scope missing");
});

test("B04 permission refresh is observed on the next resolution", async () => {
  let permissionState = "blocked";
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [candidate({ permissionState })])
  );

  const before = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });
  permissionState = "granted";
  const after = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.equal(before[0]?.availabilityState, "permission_blocked");
  assert.equal(after[0]?.availabilityState, "available");
});

test("B05 adapter outage does not remove the capability definition", async () => {
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [candidate({ adapterAvailable: false, reason: "DI unavailable" })])
  );

  const result = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.equal(result[0]?.capabilityId, capability.capabilityId);
  assert.equal(result[0]?.availabilityState, "unavailable");
  assert.equal(capability.effectClass, "read");
});

test("B06 workspace resolution does not mutate candidate provider state", async () => {
  const original = candidate();
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [original])
  );

  await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.deepEqual(original, candidate());
});

test("B07 equal inputs resolve in deterministic binding order", async () => {
  let reverse = false;
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => {
      const values = [
        candidate({ bindingId: "z", provider: "zeta" }),
        candidate({ bindingId: "a", provider: "alpha" })
      ];
      reverse = !reverse;
      return reverse ? values : [...values].reverse();
    })
  );

  const first = await resolver.resolveReadBindings({
    project,
    capabilities: [capability]
  });
  const second = await resolver.resolveReadBindings({
    project,
    capabilities: [capability]
  });

  assert.deepEqual(
    first.map((item) => item.bindingId),
    second.map((item) => item.bindingId)
  );
});

test("B08 multiple usable bindings are ambiguous instead of arbitrarily selected", async () => {
  const resolver = new HostAwareReadCapabilityBindingResolver(
    sourceFrom(() => [
      candidate({ bindingId: "one", provider: "provider-a" }),
      candidate({ bindingId: "two", provider: "provider-b" })
    ])
  );

  const result = await resolver.resolveReadBindings({
    project,
    workspace: workspace("github"),
    capabilities: [capability]
  });

  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.availabilityState === "ambiguous"));
  assert.ok(result.every((item) => /explicit binding selection/.test(item.reason ?? "")));
});
