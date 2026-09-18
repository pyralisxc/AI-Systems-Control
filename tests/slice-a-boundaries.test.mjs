import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DevelopmentIntelligenceProjectRealityProvider
} from "../dist/adapters/development-intelligence/index.js";
import {
  buildOwnerProjectRealityView,
  createSliceACapabilityCatalog
} from "../dist/slice-a/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function importSpecifiers(text) {
  const specs = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) if (match[1]) specs.push(match[1]);
  return specs;
}

async function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const raw = path.resolve(path.dirname(fromFile), specifier);
  const candidates = raw.endsWith(".js")
    ? [raw.slice(0, -3) + ".ts"]
    : [raw + ".ts", path.join(raw, "index.ts")];

  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue.
    }
  }
  return undefined;
}

async function reachableFiles(start) {
  const visited = new Set();
  const pending = [start];
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const text = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(text)) {
      const resolved = await resolveRelative(file, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...visited];
}

test("G01 DI outage remains unavailable and does not trigger local replacement analysis", async () => {
  const unavailable = async () => {
    throw new Error("Development Intelligence unavailable");
  };
  const provider = new DevelopmentIntelligenceProjectRealityProvider({
    client: {
      projectStatus: unavailable,
      projectOverview: unavailable,
      listSources: unavailable
    }
  });

  const project = {
    projectId: "project-1",
    name: "Project",
    references: [{ kind: "github_repository", value: "owner/repo" }],
    createdAt: "2026-09-18T20:00:00.000Z",
    status: "active"
  };
  const workspace = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    selectedHost: "github"
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

  const view = await buildOwnerProjectRealityView({
    project,
    workspace,
    freshnessPolicy: { warningAfterSeconds: 300, staleAfterSeconds: 1800 },
    evaluatedAt: "2026-09-18T20:10:00.000Z",
    composition: {
      realityProvider: provider,
      capabilityCatalog: createSliceACapabilityCatalog([capability]),
      bindingResolver: {
        async resolveReadBindings() {
          return [{
            bindingId: "di-unavailable",
            capabilityId: capability.capabilityId,
            projectId: project.projectId,
            workspaceId: workspace.workspaceId,
            host: "github",
            provider: "development-intelligence",
            adapter: "di-mcp",
            permissionState: "unknown",
            availabilityState: "unavailable",
            reason: "Development Intelligence unavailable"
          }];
        }
      }
    }
  });

  assert.equal(view.realityAvailability, "unavailable");
  assert.deepEqual(view.truth.observed, []);
  assert.deepEqual(view.truth.inferred, []);
  assert.equal(view.problems.length, 3);
  assert.ok(view.problems.every((problem) => problem.code.startsWith("development_intelligence_")));
});

test("G05 provider-specific vocabulary stays outside domain and port contracts", async () => {
  const coreFiles = [
    ...(await walk(path.join(srcRoot, "domain"))),
    ...(await walk(path.join(srcRoot, "ports")))
  ];
  const forbidden = /github|development[-_]intelligence|di-mcp/iu;

  const violations = [];
  for (const file of coreFiles) {
    const text = await readFile(file, "utf8");
    if (forbidden.test(text)) {
      violations.push(path.relative(repoRoot, file).split(path.sep).join("/"));
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Provider-specific vocabulary leaked into core contracts: ${violations.join(", ")}`
  );
});

test("G07 and Slice A gate: reachable application graph exposes no provider write shortcut", async () => {
  const entry = path.join(srcRoot, "slice-a", "index.ts");
  const reachable = await reachableFiles(entry);
  const forbiddenPath = /(^|\/)(mutation|mutations|write-adapters?|github-writes?)(\/|$)/iu;
  const forbiddenSymbol = /\b(createIssue|mergePullRequest|updateFile|deleteFile|executeMutation|action\.execute)\b/u;

  const violations = [];
  for (const file of reachable) {
    const relative = path.relative(srcRoot, file).split(path.sep).join("/");
    const text = await readFile(file, "utf8");
    if (forbiddenPath.test(relative) || forbiddenSymbol.test(text)) violations.push(relative);
  }

  assert.deepEqual(
    violations,
    [],
    `Slice A can reach a provider mutation shortcut: ${violations.join(", ")}`
  );
});
