import { createHash } from "node:crypto";

import {
  projectMembershipAllowsEffect,
  type EffectClass,
  type Membership,
  type Project,
  type ProjectMembership,
  type ProjectMembershipStatus
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";

export interface GrantProjectMembershipInput {
  readonly authorizedByPrincipalId: string;
  readonly membershipId: string;
  readonly projectId: string;
  readonly roles: readonly string[];
  readonly createdAt?: string;
}

export interface SetProjectMembershipStatusInput {
  readonly authorizedByPrincipalId: string;
  readonly projectMembershipId: string;
  readonly status: ProjectMembershipStatus;
  readonly at?: string;
}

export interface ProjectAuthorityContext {
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly membershipId: string;
  readonly membershipGeneration: number;
  readonly projectMembershipId: string;
  readonly projectMembershipGeneration: number;
  readonly projectId: string;
  readonly roles: readonly string[];
}

export class ProjectMembershipAuthorizationError extends Error {
  readonly code = "project_membership_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name = "ProjectMembershipAuthorizationError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + " cannot be empty.");
  return normalized;
}

function normalizedRoles(
  roles: readonly string[]
): readonly string[] {
  const result = [...new Set(
    roles.map((role) => role.trim().toLowerCase()).filter(Boolean)
  )].sort();
  if (result.length === 0) {
    throw new Error(
      "ProjectMembership must contain at least one role."
    );
  }
  return Object.freeze(result);
}

function pairKey(
  membershipId: string,
  projectId: string
): string {
  return membershipId + "\u0000" + projectId;
}

function generatedId(
  membershipId: string,
  projectId: string
): string {
  const digest = createHash("sha256")
    .update(pairKey(membershipId, projectId))
    .digest("hex")
    .slice(0, 24);
  return "project-membership:" + digest;
}

function withoutRevokedAt(
  membership: ProjectMembership
): ProjectMembership {
  const { revokedAt: _revokedAt, ...rest } = membership;
  return rest;
}

function freezeMembership(
  membership: ProjectMembership
): ProjectMembership {
  return Object.freeze({
    ...membership,
    roles: Object.freeze([...membership.roles])
  });
}

export class InMemoryProjectMembershipRegistry {
  readonly #memberships =
    new Map<string, ProjectMembership>();
  readonly #byPair = new Map<string, string>();

  constructor(
    memberships: readonly ProjectMembership[] = []
  ) {
    for (const membership of memberships) {
      this.#index(freezeMembership(membership));
    }
  }

  #index(membership: ProjectMembership): void {
    if (this.#memberships.has(
      membership.projectMembershipId
    )) {
      throw new ProjectMembershipAuthorizationError(
        "Duplicate ProjectMembership: " +
        membership.projectMembershipId
      );
    }
    const key = pairKey(
      membership.membershipId,
      membership.projectId
    );
    const existing = this.#byPair.get(key);
    if (
      existing &&
      existing !== membership.projectMembershipId
    ) {
      throw new ProjectMembershipAuthorizationError(
        "Membership already has ProjectMembership " +
        existing + " for Project " +
        membership.projectId + "."
      );
    }
    this.#memberships.set(
      membership.projectMembershipId,
      membership
    );
    this.#byPair.set(
      key,
      membership.projectMembershipId
    );
  }

  list(): readonly ProjectMembership[] {
    return Object.freeze(
      [...this.#memberships.values()].sort(
        (left, right) =>
          left.projectMembershipId.localeCompare(
            right.projectMembershipId
          )
      )
    );
  }

  get(
    projectMembershipId: string
  ): ProjectMembership | undefined {
    return this.#memberships.get(projectMembershipId);
  }

  getForMembershipProject(
    membershipId: string,
    projectId: string
  ): ProjectMembership | undefined {
    const id = this.#byPair.get(
      pairKey(membershipId, projectId)
    );
    return id ? this.#memberships.get(id) : undefined;
  }

  listForMembership(
    membershipId: string
  ): readonly ProjectMembership[] {
    return Object.freeze(
      this.list().filter(
        (membership) =>
          membership.membershipId === membershipId
      )
    );
  }

  grant(input: {
    readonly membershipId: string;
    readonly accountDomainId: string;
    readonly projectId: string;
    readonly roles: readonly string[];
    readonly authorizedByPrincipalId: string;
    readonly createdAt?: string;
  }): ProjectMembership {
    const membershipId = required(
      input.membershipId,
      "Membership ID"
    );
    const accountDomainId = required(
      input.accountDomainId,
      "AccountDomain ID"
    );
    const projectId = required(
      input.projectId,
      "Project ID"
    );
    const roles = normalizedRoles(input.roles);
    const authorizedByPrincipalId = required(
      input.authorizedByPrincipalId,
      "Authorizing Principal ID"
    );
    const existing =
      this.getForMembershipProject(
        membershipId,
        projectId
      );
    const now =
      input.createdAt ?? new Date().toISOString();

    if (existing) {
      const changed =
        existing.status !== "active" ||
        JSON.stringify(existing.roles) !==
          JSON.stringify(roles);
      if (!changed) return existing;
      const updated = freezeMembership({
        ...withoutRevokedAt(existing),
        roles,
        status: "active",
        generation: existing.generation + 1,
        updatedByPrincipalId:
          authorizedByPrincipalId,
        updatedAt: now
      });
      this.#memberships.set(
        updated.projectMembershipId,
        updated
      );
      return updated;
    }

    const created = freezeMembership({
      projectMembershipId: generatedId(
        membershipId,
        projectId
      ),
      membershipId,
      accountDomainId,
      projectId,
      roles,
      status: "active",
      generation: 1,
      grantedByPrincipalId:
        authorizedByPrincipalId,
      updatedByPrincipalId:
        authorizedByPrincipalId,
      createdAt: now,
      updatedAt: now
    });
    this.#index(created);
    return created;
  }

  setStatus(
    projectMembershipId: string,
    status: ProjectMembershipStatus,
    updatedByPrincipalId: string,
    at = new Date().toISOString()
  ): ProjectMembership {
    const existing =
      this.#memberships.get(projectMembershipId);
    if (!existing) {
      throw new ProjectMembershipAuthorizationError(
        "Unknown ProjectMembership: " +
        projectMembershipId
      );
    }
    if (existing.status === status) return existing;

    const updated = freezeMembership({
      ...withoutRevokedAt(existing),
      status,
      generation: existing.generation + 1,
      updatedByPrincipalId: required(
        updatedByPrincipalId,
        "Updating Principal ID"
      ),
      updatedAt: at,
      ...(status === "revoked"
        ? { revokedAt: at }
        : {})
    });
    this.#memberships.set(
      projectMembershipId,
      updated
    );
    return updated;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function projectFor(
  projects: readonly Project[],
  projectId: string,
  accountDomainId: string
): Project {
  const project = projects.find(
    (candidate) => candidate.projectId === projectId
  );
  if (
    !project ||
    project.accountDomainId !== accountDomainId
  ) {
    throw new ProjectMembershipAuthorizationError(
      "Project is unavailable in AccountDomain: " +
      projectId
    );
  }
  return project;
}

export class PersistentProjectMembershipRegistry {
  readonly #store: ControlRegistryStore;
  readonly #identities: PersistentIdentityRegistry;

  constructor(
    store: ControlRegistryStore,
    identities: PersistentIdentityRegistry
  ) {
    this.#store = store;
    this.#identities = identities;
  }

  async listProjectMemberships():
    Promise<readonly ProjectMembership[]> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectMembershipRegistry(
      snapshot.projectMemberships
    ).list();
  }

  async listAccessibleProjects(
    principalId: string
  ): Promise<readonly Project[]> {
    const membership =
      await this.#identities.assertActiveMembership(
        principalId,
        this.#store.accountDomainId
      );
    const snapshot = await this.#store.load();
    const registry =
      new InMemoryProjectMembershipRegistry(
        snapshot.projectMemberships
      );
    const allowed = new Set(
      registry
        .listForMembership(membership.membershipId)
        .filter(
          (projectMembership) =>
            projectMembership.status === "active"
        )
        .map(
          (projectMembership) =>
            projectMembership.projectId
        )
    );
    return Object.freeze(
      snapshot.projects
        .filter(
          (project) =>
            allowed.has(project.projectId) &&
            project.status !== "archived"
        )
        .sort(
          (left, right) =>
            left.projectId.localeCompare(
              right.projectId
            )
        )
    );
  }

  async assertProjectAccess(
    principalId: string,
    projectId: string,
    effectClass: EffectClass
  ): Promise<ProjectAuthorityContext> {
    const membership =
      await this.#identities.assertActiveMembership(
        principalId,
        this.#store.accountDomainId
      );
    const snapshot = await this.#store.load();
    projectFor(
      snapshot.projects,
      projectId,
      this.#store.accountDomainId
    );
    const projectMembership =
      new InMemoryProjectMembershipRegistry(
        snapshot.projectMemberships
      ).getForMembershipProject(
        membership.membershipId,
        projectId
      );

    if (
      !projectMembership ||
      !projectMembershipAllowsEffect(
        projectMembership,
        effectClass
      )
    ) {
      throw new ProjectMembershipAuthorizationError(
        "Principal lacks active ProjectMembership authority for " +
        projectId + " / " + effectClass + "."
      );
    }

    return Object.freeze({
      principalId,
      accountDomainId:
        this.#store.accountDomainId,
      membershipId: membership.membershipId,
      membershipGeneration:
        membership.generation,
      projectMembershipId:
        projectMembership.projectMembershipId,
      projectMembershipGeneration:
        projectMembership.generation,
      projectId,
      roles: Object.freeze([
        ...projectMembership.roles
      ])
    });
  }

  async grant(
    input: GrantProjectMembershipInput
  ): Promise<ProjectMembership> {
    const reviewer =
      await this.#identities
        .assertPrincipalCanAdministerDomain(
          input.authorizedByPrincipalId,
          this.#store.accountDomainId
        );
    const target =
      await this.#identities
        .assertActiveMembershipById(
          input.membershipId
        );
    if (
      target.accountDomainId !==
      this.#store.accountDomainId
    ) {
      throw new ProjectMembershipAuthorizationError(
        "Target Membership belongs to another AccountDomain."
      );
    }
    if (
      reviewer.accountDomainId !==
      target.accountDomainId
    ) {
      throw new ProjectMembershipAuthorizationError(
        "Reviewer and target Membership belong to different AccountDomains."
      );
    }

    return mutateControlRegistry(
      this.#store,
      (snapshot) => {
        projectFor(
          snapshot.projects,
          input.projectId,
          this.#store.accountDomainId
        );
        const registry =
          new InMemoryProjectMembershipRegistry(
            snapshot.projectMemberships
          );
        const before =
          stableJson(registry.list());
        const result = registry.grant({
          membershipId: target.membershipId,
          accountDomainId:
            this.#store.accountDomainId,
          projectId: input.projectId,
          roles: input.roles,
          authorizedByPrincipalId:
            input.authorizedByPrincipalId,
          ...(input.createdAt
            ? { createdAt: input.createdAt }
            : {})
        });
        const projectMemberships =
          registry.list();
        return {
          result,
          projects: snapshot.projects,
          connections: snapshot.connections,
          projectConnectionBindings:
            snapshot.projectConnectionBindings,
          delegations: snapshot.delegations,
          projectMemberships,
          changed:
            before !== stableJson(
              projectMemberships
            )
        };
      }
    );
  }

  async setStatus(
    input: SetProjectMembershipStatusInput
  ): Promise<ProjectMembership> {
    await this.#identities
      .assertPrincipalCanAdministerDomain(
        input.authorizedByPrincipalId,
        this.#store.accountDomainId
      );

    return mutateControlRegistry(
      this.#store,
      (snapshot) => {
        const registry =
          new InMemoryProjectMembershipRegistry(
            snapshot.projectMemberships
          );
        const existing = registry.get(
          input.projectMembershipId
        );
        if (
          !existing ||
          existing.accountDomainId !==
            this.#store.accountDomainId
        ) {
          throw new ProjectMembershipAuthorizationError(
            "ProjectMembership is unavailable in this AccountDomain."
          );
        }
        const before =
          stableJson(registry.list());
        const result = registry.setStatus(
          input.projectMembershipId,
          input.status,
          input.authorizedByPrincipalId,
          input.at
        );
        const projectMemberships =
          registry.list();
        return {
          result,
          projects: snapshot.projects,
          connections: snapshot.connections,
          projectConnectionBindings:
            snapshot.projectConnectionBindings,
          delegations: snapshot.delegations,
          projectMemberships,
          changed:
            before !== stableJson(
              projectMemberships
            )
        };
      }
    );
  }

  async ensurePersonalOwnerProjects(
    principalId: string
  ): Promise<void> {
    const membership =
      await this.#identities
        .assertPrincipalCanAdministerDomain(
          principalId,
          this.#store.accountDomainId
        );
    const snapshot = await this.#store.load();
    const registry =
      new InMemoryProjectMembershipRegistry(
        snapshot.projectMemberships
      );
    const missing = snapshot.projects.filter(
      (project) =>
        !registry.getForMembershipProject(
          membership.membershipId,
          project.projectId
        )
    );
    for (const project of missing) {
      await this.grant({
        authorizedByPrincipalId: principalId,
        membershipId:
          membership.membershipId,
        projectId: project.projectId,
        roles: ["project_admin"]
      });
    }
  }
}
