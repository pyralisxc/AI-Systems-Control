import type {
  Connection,
  Project,
  ProjectConnectionBinding
} from "../domain/index.js";
import type {
  ExternalRepositoryAttestation,
  ExternalRepositoryAttestor
} from "../ports/index.js";
import {
  PersistentConnectionRegistry
} from "./connection-registry.js";
import {
  DelegationService,
  type IssuedDelegation
} from "./delegation-service.js";
import {
  PersistentProjectConnectionBindingRegistry
} from "./project-connection-binding-registry.js";
import {
  PersistentProjectRegistry
} from "./persistent-project-registry.js";

export interface GitHubProjectAuthorizationServiceOptions {
  readonly projects: PersistentProjectRegistry;
  readonly connections: PersistentConnectionRegistry;
  readonly bindings: PersistentProjectConnectionBindingRegistry;
  readonly delegations: DelegationService;
  readonly repositoryAttestor: ExternalRepositoryAttestor;
}

export interface BindGitHubProjectInput {
  readonly principalId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly executionCapability: string;
}

export interface BoundGitHubProject {
  readonly projectId: string;
  readonly repository: string;
  readonly connectionId: string;
  readonly executionCapability: string;
  readonly attestation: ExternalRepositoryAttestation;
  readonly bindings: readonly ProjectConnectionBinding[];
}

export interface GitHubReadDelegations {
  readonly sourceRead: IssuedDelegation;
  readonly repositoryRead: IssuedDelegation;
}

export class GitHubProjectAuthorizationError extends Error {
  readonly code = "github_project_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name = "GitHubProjectAuthorizationError";
  }
}

function canonicalRepository(project: Project): string {
  const canonical = project.references.find(
    (reference) =>
      reference.kind === "github_repository" &&
      reference.canonical === true
  );
  if (!canonical?.value.trim()) {
    throw new GitHubProjectAuthorizationError(
      "Project " + project.projectId +
      " has no canonical GitHub repository reference."
    );
  }
  return canonical.value.trim();
}

function installationId(connection: Connection): string {
  if (
    connection.provider !== "github" ||
    connection.authenticationStrategy !== "app_installation"
  ) {
    throw new GitHubProjectAuthorizationError(
      "Connection " + connection.connectionId +
      " is not a GitHub App installation Connection."
    );
  }
  const prefix = "installation:";
  if (!connection.providerAccountId.startsWith(prefix)) {
    throw new GitHubProjectAuthorizationError(
      "GitHub Connection identity is not an installation."
    );
  }
  const id = connection.providerAccountId.slice(prefix.length).trim();
  if (!/^[1-9][0-9]{0,19}$/u.test(id)) {
    throw new GitHubProjectAuthorizationError(
      "GitHub installation ID is invalid."
    );
  }
  return id;
}

function requireCapabilities(
  capabilities: readonly string[],
  required: readonly string[]
): void {
  const available = new Set(capabilities);
  const missing = required.filter(
    (capability) => !available.has(capability)
  );
  if (missing.length > 0) {
    throw new GitHubProjectAuthorizationError(
      "GitHub repository attestation is missing required capability: " +
      missing.join(", ") + "."
    );
  }
}

function sameRepository(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export class GitHubProjectAuthorizationService {
  readonly #projects: PersistentProjectRegistry;
  readonly #connections: PersistentConnectionRegistry;
  readonly #bindings: PersistentProjectConnectionBindingRegistry;
  readonly #delegations: DelegationService;
  readonly #repositoryAttestor: ExternalRepositoryAttestor;

  constructor(options: GitHubProjectAuthorizationServiceOptions) {
    this.#projects = options.projects;
    this.#connections = options.connections;
    this.#bindings = options.bindings;
    this.#delegations = options.delegations;
    this.#repositoryAttestor = options.repositoryAttestor;
  }

  async #attest(
    principalId: string,
    project: Project,
    connection: Connection,
    requiredCapabilities: readonly string[]
  ): Promise<ExternalRepositoryAttestation> {
    if (!project.accountDomainId) {
      throw new GitHubProjectAuthorizationError(
        "Project " + project.projectId +
        " has no AccountDomain assignment."
      );
    }
    if (connection.accountDomainId !== project.accountDomainId) {
      throw new GitHubProjectAuthorizationError(
        "GitHub Connection and Project belong to different AccountDomains."
      );
    }
    if (connection.status !== "active") {
      throw new GitHubProjectAuthorizationError(
        "GitHub Connection is not active."
      );
    }

    const repository = canonicalRepository(project);
    const attestation =
      await this.#repositoryAttestor.attestRepository({
        connectionReference: installationId(connection),
        repository,
        principalId,
        accountDomainId: project.accountDomainId
      });

    if (!sameRepository(attestation.repository, repository)) {
      throw new GitHubProjectAuthorizationError(
        "Repository attestation does not match the Project."
      );
    }
    if (
      attestation.connectionReference !==
      installationId(connection)
    ) {
      throw new GitHubProjectAuthorizationError(
        "Repository attestation does not match the GitHub Connection."
      );
    }

    requireCapabilities(
      attestation.capabilities,
      requiredCapabilities
    );

    await this.#connections.verify(
      connection.connectionId,
      {
        status: "active",
        capabilities: attestation.capabilities,
        verifiedAt: attestation.verifiedAt
      }
    );

    return attestation;
  }

  async bindProject(
    input: BindGitHubProjectInput
  ): Promise<BoundGitHubProject> {
    await this.#connections.assertPrincipalCanAdminister(
      input.principalId
    );

    const project = await this.#projects.get(input.projectId);
    if (!project) {
      throw new GitHubProjectAuthorizationError(
        "Unknown Project: " + input.projectId
      );
    }

    const connection =
      await this.#connections.get(input.connectionId);
    if (!connection) {
      throw new GitHubProjectAuthorizationError(
        "Unknown Connection: " + input.connectionId
      );
    }

    const executionCapability =
      input.executionCapability.trim();
    if (!executionCapability) {
      throw new GitHubProjectAuthorizationError(
        "Conductor execution capability is required."
      );
    }

    const required = Object.freeze([
      "source.read",
      "repository.read",
      executionCapability
    ]);
    const attestation = await this.#attest(
      input.principalId,
      project,
      connection,
      required
    );
    const resource = Object.freeze({
      kind: "github_repository",
      value: canonicalRepository(project)
    });

    const bindings = await Promise.all([
      this.#bindings.register({
        projectId: project.projectId,
        connectionId: connection.connectionId,
        capabilityScope: {
          kind: "exact",
          value: "source.read"
        },
        resource,
        selection: "explicit"
      }),
      this.#bindings.register({
        projectId: project.projectId,
        connectionId: connection.connectionId,
        capabilityScope: {
          kind: "exact",
          value: "repository.read"
        },
        resource,
        selection: "explicit"
      }),
      this.#bindings.register({
        projectId: project.projectId,
        connectionId: connection.connectionId,
        capabilityScope: {
          kind: "exact",
          value: executionCapability
        },
        resource,
        selection: "explicit",
        approvalRequiredFor: ["mutate"]
      })
    ]);

    return Object.freeze({
      projectId: project.projectId,
      repository: resource.value,
      connectionId: connection.connectionId,
      executionCapability,
      attestation,
      bindings: Object.freeze(bindings)
    });
  }

  async #refreshBoundConnection(
    principalId: string,
    projectId: string,
    capabilityId: string,
    requiredCapabilities: readonly string[],
    effectClass: "read" | "mutate"
  ): Promise<void> {
    await this.#delegations
      .assertPrincipalProjectAccess(
        principalId,
        projectId,
        effectClass
      );
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new GitHubProjectAuthorizationError(
        "Unknown Project: " + projectId
      );
    }

    const resolution = await this.#bindings.resolve({
      projectId,
      capabilityId
    });
    if (
      resolution.status !== "available" ||
      !resolution.connection
    ) {
      throw new GitHubProjectAuthorizationError(
        resolution.reason ??
        "GitHub Project binding is unavailable."
      );
    }

    await this.#attest(
      principalId,
      project,
      resolution.connection,
      requiredCapabilities
    );
  }

  async issueDevelopmentIntelligenceDelegations(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly expiresInSeconds?: number;
    readonly issuedAt?: string;
  }): Promise<GitHubReadDelegations> {
    await this.#refreshBoundConnection(
      input.principalId,
      input.projectId,
      "source.read",
      ["source.read", "repository.read"],
      "read"
    );

    const sourceRead = await this.#delegations.issue({
      principalId: input.principalId,
      projectId: input.projectId,
      capabilityId: "source.read",
      effectClass: "read",
      audience: "development-intelligence",
      ...(input.expiresInSeconds
        ? { expiresInSeconds: input.expiresInSeconds }
        : {}),
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {})
    });
    const repositoryRead = await this.#delegations.issue({
      principalId: input.principalId,
      projectId: input.projectId,
      capabilityId: "repository.read",
      effectClass: "read",
      audience: "development-intelligence",
      ...(input.expiresInSeconds
        ? { expiresInSeconds: input.expiresInSeconds }
        : {}),
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {})
    });

    return Object.freeze({
      sourceRead,
      repositoryRead
    });
  }

  async issueConductorDelegation(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly capabilityId: string;
    readonly approvalReference: string;
    readonly expiresInSeconds?: number;
    readonly issuedAt?: string;
  }): Promise<IssuedDelegation> {
    const capabilityId = input.capabilityId.trim();
    if (!capabilityId) {
      throw new GitHubProjectAuthorizationError(
        "Conductor capability is required."
      );
    }
    const approvalReference =
      input.approvalReference.trim();
    if (!approvalReference) {
      throw new GitHubProjectAuthorizationError(
        "Conductor mutation delegation requires an approval reference."
      );
    }

    await this.#refreshBoundConnection(
      input.principalId,
      input.projectId,
      capabilityId,
      [capabilityId],
      "mutate"
    );

    return this.#delegations.issue({
      principalId: input.principalId,
      projectId: input.projectId,
      capabilityId,
      effectClass: "mutate",
      audience: "conductor",
      approvalReference,
      ...(input.expiresInSeconds
        ? { expiresInSeconds: input.expiresInSeconds }
        : {}),
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {})
    });
  }
}
