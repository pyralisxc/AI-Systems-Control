import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const src = path.join(root, "src");
const failures = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      files.push(full);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function imports(text) {
  const found = [];
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) found.push(match[1]);
  }
  return found;
}

function isControlPlaneContract(rel) {
  return [
    "src/domain/",
    "src/ports/",
    "src/application/",
    "src/adapters/",
    "src/slice-a/",
    "src/composition/"
  ].some((prefix) => rel.startsWith(prefix));
}

for (const file of await walk(src)) {
  const rel = relative(file);
  const source = await readFile(file, "utf8");

  if (source.includes("\t")) failures.push(`${rel}: tabs are not allowed`);
  if (isControlPlaneContract(rel) && /\bany\b/.test(source)) {
    failures.push(`${rel}: avoid the 'any' type in control-plane contracts`);
  }

  for (const specifier of imports(source)) {
    if (
      rel.startsWith("src/domain/") &&
      /\.\.\/(ports|slice-a|adapters|application|composition|app|features|web)/.test(specifier)
    ) {
      failures.push(`${rel}: domain must not depend on ${specifier}`);
    }
    if (
      rel.startsWith("src/ports/") &&
      /\.\.\/(slice-a|adapters|application|composition|app|features|web)/.test(specifier)
    ) {
      failures.push(`${rel}: ports must not depend on ${specifier}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    "Lint/architecture failures:\n" +
      failures.map((failure) => `- ${failure}`).join("\n")
  );
  process.exitCode = 1;
} else {
  console.log("lint: source boundaries and contract hygiene passed");
}
