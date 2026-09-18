import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const entry = path.join(srcRoot, "slice-a", "index.ts");

function importSpecifiers(text) {
  const specs = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) specs.push(match[1]);
  }
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
      // Try next candidate.
    }
  }
  return undefined;
}

async function reachableFiles(start) {
  const visited = new Set();
  const pending = [start];

  while (pending.length > 0) {
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

test("Slice A source dependency graph cannot reach a mutation adapter", async () => {
  const reachable = await reachableFiles(entry);
  const normalized = reachable.map((file) => path.relative(srcRoot, file).split(path.sep).join("/"));
  const forbidden = normalized.filter((file) => /(^|\/)(mutation|mutations|write-adapters?)(\/|$)/i.test(file));

  assert.deepEqual(
    forbidden,
    [],
    `Slice A reached mutation adapter paths: ${forbidden.join(", ")}`
  );
});

test("Slice A port surface contains no execution method", async () => {
  const contracts = await readFile(path.join(srcRoot, "slice-a", "contracts.ts"), "utf8");
  const ports = await readFile(path.join(srcRoot, "ports", "project-reality-provider.ts"), "utf8");
  const combined = `${contracts}\n${ports}`;

  assert.doesNotMatch(combined, /\b(execute|mutate|write|delete|createIssue|mergePullRequest)\s*\(/);
});
