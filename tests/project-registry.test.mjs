import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryProjectRegistry,
  ProjectIdentityConflictError,
  normalizeGithubRepository
} from "../dist/application/index.js";

test("A01 the same GitHub repository resolves to one durable Project identity", () => {
  const registry = new InMemoryProjectRegistry();
  const first = registry.resolveOrRegisterGithubProject({
    repository: "https://github.com/Owner/Repo.git",
    name: "Original"
  });
  const second = registry.resolveOrRegisterGithubProject({
    repository: "owner/repo",
    name: "Ignored duplicate name"
  });

  assert.equal(first.projectId, second.projectId);
  assert.strictEqual(first, second);
  assert.equal(normalizeGithubRepository("git@github.com:OWNER/REPO.git"), "owner/repo");
});

test("A01 conflicting explicit identity for an already-known repository is rejected", () => {
  const registry = new InMemoryProjectRegistry();
  registry.resolveOrRegisterGithubProject({
    repository: "owner/repo",
    projectId: "project-a"
  });

  assert.throws(
    () => registry.resolveOrRegisterGithubProject({
      repository: "owner/repo",
      projectId: "project-b"
    }),
    (error) => error instanceof ProjectIdentityConflictError
  );
});

test("A02 repository rename preserves Project identity and old alias resolution", () => {
  const registry = new InMemoryProjectRegistry();
  const original = registry.resolveOrRegisterGithubProject({
    repository: "owner/old-name",
    projectId: "project-1"
  });

  const reconciled = registry.reconcileGithubRepository(
    original.projectId,
    "owner/new-name"
  );

  assert.equal(reconciled.status, "updated");
  assert.equal(reconciled.project.projectId, original.projectId);
  assert.equal(
    reconciled.project.references.find((reference) => reference.canonical)?.value,
    "owner/new-name"
  );
  assert.equal(registry.getByGithubRepository("owner/old-name")?.projectId, original.projectId);
  assert.equal(registry.getByGithubRepository("owner/new-name")?.projectId, original.projectId);
});

test("A03 inaccessible repository marks Project unavailable without deleting identity", () => {
  const registry = new InMemoryProjectRegistry();
  const project = registry.resolveOrRegisterGithubProject({
    repository: "owner/repo",
    projectId: "project-1"
  });

  const unavailable = registry.markUnavailable(project.projectId);

  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.projectId, "project-1");
  assert.equal(registry.get("project-1")?.projectId, "project-1");
  assert.equal(registry.getByGithubRepository("owner/repo")?.projectId, "project-1");
});

test("A04 conflicting repository reconciliation is surfaced without merging Projects", () => {
  const registry = new InMemoryProjectRegistry();
  const first = registry.resolveOrRegisterGithubProject({
    repository: "owner/one",
    projectId: "project-1"
  });
  const second = registry.resolveOrRegisterGithubProject({
    repository: "owner/two",
    projectId: "project-2"
  });

  const result = registry.reconcileGithubRepository(first.projectId, "owner/two");

  assert.equal(result.status, "conflict");
  assert.equal(result.conflictingProjectId, second.projectId);
  assert.equal(registry.get("project-1")?.references.find((reference) => reference.canonical)?.value, "owner/one");
  assert.equal(registry.get("project-2")?.references.find((reference) => reference.canonical)?.value, "owner/two");
});
