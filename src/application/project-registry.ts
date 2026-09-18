import type { Project, ProjectReference } from "../domain/index.js";

export interface ResolveGithubProjectInput {
  readonly repository: string;
  readonly name?: string;
  readonly projectId?: string;
  readonly createdAt?: string;
}

export interface GithubRepositoryReconciliation {
  readonly status: "updated" | "unchanged" | "conflict";
  readonly project: Project;
  readonly repository: string;
  readonly conflictingProjectId?: string;
}

export class ProjectIdentityConflictError extends Error {
  readonly code = "project_identity_conflict";

  constructor(message: string) {
    super(message);
    this.name = "ProjectIdentityConflictError";
  }
}

export function normalizeGithubRepository(repository: string): string {
  const stripped = repository
    .trim()
    .replace(/^https?:\/\/github\.com\//iu, "")
    .replace(/^git@github\.com:/iu, "")
    .replace(/\.git$/iu, "")
    .replace(/^\/+|\/+$/gu, "");

  const segments = stripped.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`GitHub repository identity must be owner/repository: ${repository}`);
  }
  return `${segments[0]!.toLowerCase()}/${segments[1]!.toLowerCase()}`;
}

function canonicalGithubReference(project: Project): ProjectReference | undefined {
  return project.references.find(
    (reference) => reference.kind === "github_repository" && reference.canonical === true
  );
}

function freezeProject(project: Project): Project {
  return Object.freeze({
    ...project,
    references: Object.freeze([...project.references])
  });
}

export class InMemoryProjectRegistry {
  readonly #projects = new Map<string, Project>();
  readonly #githubReferences = new Map<string, string>();

  get(projectId: string): Project | undefined {
    return this.#projects.get(projectId);
  }

  getByGithubRepository(repository: string): Project | undefined {
    const projectId = this.#githubReferences.get(normalizeGithubRepository(repository));
    return projectId ? this.#projects.get(projectId) : undefined;
  }

  resolveOrRegisterGithubProject(input: ResolveGithubProjectInput): Project {
    const repository = normalizeGithubRepository(input.repository);
    const existingId = this.#githubReferences.get(repository);
    if (existingId) {
      if (input.projectId && input.projectId !== existingId) {
        throw new ProjectIdentityConflictError(
          `Repository ${repository} already belongs to project ${existingId}, not ${input.projectId}.`
        );
      }
      return this.#projects.get(existingId)!;
    }

    const projectId = input.projectId ?? `github:${repository}`;
    const existingProject = this.#projects.get(projectId);
    if (existingProject) {
      const existingRepository = canonicalGithubReference(existingProject)?.value ?? "unknown";
      throw new ProjectIdentityConflictError(
        `Project ${projectId} already exists with canonical repository ${existingRepository}.`
      );
    }

    const project = freezeProject({
      projectId,
      name: input.name ?? repository,
      references: [{
        kind: "github_repository",
        value: repository,
        canonical: true
      }],
      createdAt: input.createdAt ?? new Date().toISOString(),
      status: "active"
    });

    this.#projects.set(projectId, project);
    this.#githubReferences.set(repository, projectId);
    return project;
  }

  reconcileGithubRepository(projectId: string, nextRepository: string): GithubRepositoryReconciliation {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);

    const repository = normalizeGithubRepository(nextRepository);
    const existingOwner = this.#githubReferences.get(repository);
    if (existingOwner && existingOwner !== projectId) {
      return Object.freeze({
        status: "conflict",
        project,
        repository,
        conflictingProjectId: existingOwner
      });
    }

    const currentCanonical = canonicalGithubReference(project);
    if (currentCanonical?.value === repository) {
      return Object.freeze({ status: "unchanged", project, repository });
    }

    const references: ProjectReference[] = project.references.map((reference) =>
      reference.kind === "github_repository"
        ? { ...reference, canonical: false }
        : reference
    );
    const existingAliasIndex = references.findIndex(
      (reference) =>
        reference.kind === "github_repository" &&
        normalizeGithubRepository(reference.value) === repository
    );

    if (existingAliasIndex >= 0) {
      const existingAlias = references[existingAliasIndex]!;
      references[existingAliasIndex] = { ...existingAlias, value: repository, canonical: true };
    } else {
      references.push({ kind: "github_repository", value: repository, canonical: true });
    }

    const updated = freezeProject({ ...project, references });
    this.#projects.set(projectId, updated);
    this.#githubReferences.set(repository, projectId);
    return Object.freeze({ status: "updated", project: updated, repository });
  }

  markUnavailable(projectId: string): Project {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const updated = freezeProject({ ...project, status: "unavailable" });
    this.#projects.set(projectId, updated);
    return updated;
  }
}
