import type { Project, ProjectReference } from "../domain/index.js";

export interface ResolveGithubProjectInput {
  readonly repository: string;
  readonly name?: string;
  readonly aliases?: readonly string[];
  readonly accountDomainId?: string;
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
    throw new Error("GitHub repository identity must be owner/repository: " + repository);
  }
  return segments[0]!.toLowerCase() + "/" + segments[1]!.toLowerCase();
}

export function normalizeProjectAlias(alias: string): string {
  const normalized = alias.trim().replace(/\s+/gu, " ").toLowerCase();
  if (!normalized) throw new Error("Project alias cannot be empty.");
  return normalized;
}

function normalizeAccountDomainId(accountDomainId: string): string {
  const normalized = accountDomainId.trim();
  if (!normalized) throw new Error("Account domain cannot be empty.");
  return normalized;
}

function canonicalGithubReference(project: Project): ProjectReference | undefined {
  return project.references.find(
    (reference) => reference.kind === "github_repository" && reference.canonical === true
  );
}

function freezeProject(project: Project): Project {
  return Object.freeze({
    ...project,
    ...(project.aliases ? { aliases: Object.freeze([...project.aliases]) } : {}),
    references: Object.freeze([...project.references])
  });
}

export class InMemoryProjectRegistry {
  readonly #projects = new Map<string, Project>();
  readonly #githubReferences = new Map<string, string>();
  readonly #aliases = new Map<string, string>();

  constructor(projects: readonly Project[] = []) {
    for (const projectValue of projects) this.#indexProject(freezeProject(projectValue));
  }

  #claimIndex(
    index: Map<string, string>,
    key: string,
    projectId: string,
    description: string
  ): void {
    const existing = index.get(key);
    if (existing && existing !== projectId) {
      throw new ProjectIdentityConflictError(
        description + " " + key + " belongs to both " + existing + " and " + projectId + "."
      );
    }
    index.set(key, projectId);
  }

  #indexProject(project: Project): void {
    const existingProject = this.#projects.get(project.projectId);
    if (existingProject && existingProject !== project) {
      throw new ProjectIdentityConflictError("Duplicate project ID: " + project.projectId);
    }

    this.#projects.set(project.projectId, project);

    for (const reference of project.references) {
      if (reference.kind !== "github_repository") continue;
      this.#claimIndex(
        this.#githubReferences,
        normalizeGithubRepository(reference.value),
        project.projectId,
        "GitHub repository"
      );
    }

    for (const alias of project.aliases ?? []) {
      this.#claimIndex(
        this.#aliases,
        normalizeProjectAlias(alias),
        project.projectId,
        "Project alias"
      );
    }
  }

  #replaceProject(project: Project): Project {
    const frozen = freezeProject(project);
    this.#projects.set(frozen.projectId, frozen);

    for (const reference of frozen.references) {
      if (reference.kind === "github_repository") {
        this.#claimIndex(
          this.#githubReferences,
          normalizeGithubRepository(reference.value),
          frozen.projectId,
          "GitHub repository"
        );
      }
    }
    for (const alias of frozen.aliases ?? []) {
      this.#claimIndex(
        this.#aliases,
        normalizeProjectAlias(alias),
        frozen.projectId,
        "Project alias"
      );
    }
    return frozen;
  }

  listProjects(): readonly Project[] {
    return Object.freeze(
      [...this.#projects.values()].sort((left, right) =>
        left.projectId.localeCompare(right.projectId)
      )
    );
  }

  get(projectId: string): Project | undefined {
    return this.#projects.get(projectId);
  }

  getByAlias(alias: string): Project | undefined {
    const projectId = this.#aliases.get(normalizeProjectAlias(alias));
    return projectId ? this.#projects.get(projectId) : undefined;
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
          "Repository " + repository + " already belongs to project " + existingId +
          ", not " + input.projectId + "."
        );
      }
      const existing = this.#projects.get(existingId)!;
      if (input.accountDomainId) {
        return this.setAccountDomain(existing.projectId, input.accountDomainId);
      }
      return existing;
    }

    const projectId = input.projectId ?? "github:" + repository;
    const existingProject = this.#projects.get(projectId);
    if (existingProject) {
      const existingRepository = canonicalGithubReference(existingProject)?.value ?? "unknown";
      throw new ProjectIdentityConflictError(
        "Project " + projectId + " already exists with canonical repository " +
        existingRepository + "."
      );
    }

    const now = input.createdAt ?? new Date().toISOString();
    const accountDomainId = input.accountDomainId
      ? normalizeAccountDomainId(input.accountDomainId)
      : undefined;
    const project = freezeProject({
      projectId,
      ...(accountDomainId ? { accountDomainId } : {}),
      name: input.name ?? repository,
      ...(input.aliases && input.aliases.length > 0
        ? { aliases: Object.freeze([...new Set(input.aliases.map((alias) => alias.trim()))]) }
        : {}),
      references: [{
        kind: "github_repository",
        value: repository,
        canonical: true
      }],
      createdAt: now,
      updatedAt: now,
      lastReconciledAt: now,
      status: "active"
    });

    this.#indexProject(project);
    return project;
  }

  setAccountDomain(projectId: string, accountDomainIdInput: string): Project {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error("Unknown project: " + projectId);
    const accountDomainId = normalizeAccountDomainId(accountDomainIdInput);

    if (project.accountDomainId === accountDomainId) return project;
    if (project.accountDomainId && project.accountDomainId !== accountDomainId) {
      throw new ProjectIdentityConflictError(
        "Project " + projectId + " is already assigned to account domain " +
        project.accountDomainId + "; explicit migration is required."
      );
    }

    return this.#replaceProject({
      ...project,
      accountDomainId,
      updatedAt: new Date().toISOString()
    });
  }

  registerAlias(projectId: string, alias: string): Project {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error("Unknown project: " + projectId);

    const normalized = normalizeProjectAlias(alias);
    const existingOwner = this.#aliases.get(normalized);
    if (existingOwner && existingOwner !== projectId) {
      throw new ProjectIdentityConflictError(
        "Project alias " + alias + " already belongs to project " + existingOwner + "."
      );
    }

    if ((project.aliases ?? []).some((value) => normalizeProjectAlias(value) === normalized)) {
      return project;
    }

    const now = new Date().toISOString();
    return this.#replaceProject({
      ...project,
      aliases: Object.freeze([...(project.aliases ?? []), alias.trim()]),
      updatedAt: now
    });
  }

  reconcileGithubRepository(projectId: string, nextRepository: string): GithubRepositoryReconciliation {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error("Unknown project: " + projectId);

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

    const now = new Date().toISOString();
    const updated = this.#replaceProject({
      ...project,
      references,
      updatedAt: now,
      lastReconciledAt: now
    });
    return Object.freeze({ status: "updated", project: updated, repository });
  }

  markUnavailable(projectId: string): Project {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error("Unknown project: " + projectId);
    const now = new Date().toISOString();
    return this.#replaceProject({
      ...project,
      status: "unavailable",
      updatedAt: now,
      lastReconciledAt: now
    });
  }
}
