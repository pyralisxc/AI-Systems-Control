import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "config", "slice-a-battle-test-coverage.json");

const required = [
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08",
  "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08",
  "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08",
  "G01", "G05", "G07"
];

test("Slice A battle-test manifest covers every required architecture scenario", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  for (const id of required) {
    assert.equal(typeof manifest[id], "string", `Missing battle-test mapping for ${id}`);
    const file = path.join(repoRoot, manifest[id]);
    assert.equal((await stat(file)).isFile(), true, `Mapped test file does not exist for ${id}: ${manifest[id]}`);
  }
});
