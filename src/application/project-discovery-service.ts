import type {
  Project,
  ProjectReference,
  ProjectStatus
} from "../domain/index.js";
import {
  PersistentProjectMembershipRegistry
} from "./project-membership-registry.js";
import {
  PersistentProjectRegistry
} from "./persistent-project-registry.js";

export interface AccessibleProjectView {
  readonly projectId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly roles: readonly string[];
  readonly canonicalReference?: ProjectReference;
}

export class ProjectDiscoveryAuthorizationError extends Error {
  readonly code = "project_discovery_authorization_failed";

  constructor() {
    super("Project is unavailable.");
    this.name = "ProjectDiscoveryAuthorizationError";
  }
}

function safeProjectView(
  project: Project,
  roles: readonly string[]
): AccessibleProjectView {
  const canonicalReference =
    project.references.find(
      (reference) => reference.canonical === true
    );

  return Object.freeze({
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    roles: Object.freeze([...roles].sort()),
    ...(canonicalReference
      ? {
          canonicalReference: Object.freeze({
            kind: canonicalReference.kind,
            value: canonicalReference.value,
            canonical: true
          })
        }
      : {})
  });
}

export class ProjectDiscoveryService {
  readonly #projects: PersistentProjectRegistry;
  readonly #projectMemberships:
    PersistentProjectMembershipRegistry;

  constructor(input: {
    readonly projects: PersistentProjectRegistry;
    readonly projectMemberships:
      PersistentProjectMembershipRegistry;
  }) {
    this.#projects = input.projects;
    this.#projectMemberships =
      input.projectMemberships;
  }

  async list(
    principalId: string
  ): Promise<{
    readonly projects:
      readonly AccessibleProjectView[];
  }> {
    const projects =
      await this.#projectMemberships
        .listAccessibleProjects(principalId);

    const views = await Promise.all(
      projects.map(async (project) => {
        const authority =
          await this.#projectMemberships
            .assertProjectAccess(
              principalId,
              project.projectId,
              "read"
            );
        return safeProjectView(
          project,
          authority.roles
        );
      })
    );

    return Object.freeze({
      projects: Object.freeze(views)
    });
  }

  async get(
    principalId: string,
    projectId: string
  ): Promise<AccessibleProjectView> {
    const normalized = projectId.trim();
    if (!normalized) {
      throw new ProjectDiscoveryAuthorizationError();
    }

    try {
      const authority =
        await this.#projectMemberships
          .assertProjectAccess(
            principalId,
            normalized,
            "read"
          );
      const project =
        await this.#projects.get(normalized);
      if (
        !project ||
        project.status === "archived"
      ) {
        throw new ProjectDiscoveryAuthorizationError();
      }
      return safeProjectView(
        project,
        authority.roles
      );
    } catch (error) {
      if (
        error instanceof
        ProjectDiscoveryAuthorizationError
      ) {
        throw error;
      }
      throw new ProjectDiscoveryAuthorizationError();
    }
  }
}
