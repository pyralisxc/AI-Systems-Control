import type {
  Connection,
  EffectClass,
  Project,
  ProjectConnectionBinding
} from "../domain/index.js";
import type {
  ExternalConnectionAttestor,
  ExternalRepositoryAttestation
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

export interface VercelProjectAuthorizationServiceOptions {
  readonly projects: PersistentProjectRegistry;
  readonly connections: PersistentConnectionRegistry;
  readonly bindings: PersistentProjectConnectionBindingRegistry;
  readonly delegations: DelegationService;
  readonly attestor: ExternalConnectionAttestor;
}

export interface BoundVercelProject {
  readonly projectId: string;
  readonly repository: string;
  readonly connectionId: string;
  readonly attestation: ExternalRepositoryAttestation;
  readonly bindings: readonly ProjectConnectionBinding[];
}

export class VercelProjectAuthorizationError extends Error {
  readonly code =
    "vercel_project_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name =
      "VercelProjectAuthorizationError";
  }
}

function canonicalRepository(project: Project): string {
  const canonical = project.references.find(
    (reference) =>
      reference.kind === "github_repository" &&
      reference.canonical === true
  );
  if (!canonical?.value.trim()) {
    throw new VercelProjectAuthorizationError(
      "Project " + project.projectId +
      " has no canonical GitHub repository reference."
    );
  }
  return canonical.value.trim();
}

function connectionReference(
  connection: Connection
): string {
  if (
    connection.provider !== "vercel" ||
    connection.authenticationStrategy !==
      "delegated_service"
  ) {
    throw new VercelProjectAuthorizationError(
      "Connection " + connection.connectionId +
      " is not a delegated Vercel Connection."
    );
  }
  const prefix = "installation:";
  if (!connection.providerAccountId.startsWith(prefix)) {
    throw new VercelProjectAuthorizationError(
      "Vercel Connection identity is not an installation."
    );
  }
  const reference =
    connection.providerAccountId.slice(prefix.length);
  if (!/^icfg_[A-Za-z0-9_-]+$/u.test(reference)) {
    throw new VercelProjectAuthorizationError(
      "Vercel installation identity is invalid."
    );
  }
  return reference;
}

function sameRepository(
  left: string,
  right: string
): boolean {
  return (
    left.trim().toLowerCase() ===
    right.trim().toLowerCase()
  );
}

function requireCapabilities(
  attestation: ExternalRepositoryAttestation,
  required: readonly string[]
): void {
  const available =
    new Set(attestation.capabilities);
  const missing = required.filter(
    (capability) => !available.has(capability)
  );
  if (missing.length > 0) {
    throw new VercelProjectAuthorizationError(
      "Vercel attestation is missing required capability: " +
      missing.join(", ") + "."
    );
  }
}

function requireResource(
  attestation: ExternalRepositoryAttestation
): { readonly kind: string; readonly value: string } {
  if (
    !attestation.resource ||
    attestation.resource.kind !== "vercel_project" ||
    !/^prj_[A-Za-z0-9]+$/u.test(
      attestation.resource.value
    )
  ) {
    throw new VercelProjectAuthorizationError(
      "Vercel attestation does not identify an exact Vercel project."
    );
  }
  return attestation.resource;
}

function expectedEffectClass(
  capabilityId: string
): "read" | "mutate" {
  if (capabilityId.endsWith(".read")) {
    return "read";
  }
  if (capabilityId.endsWith(".write")) {
    return "mutate";
  }
  throw new VercelProjectAuthorizationError(
    "Vercel capability must declare a read or write effect."
  );
}

function readCapabilities(
  attestation: ExternalRepositoryAttestation
): readonly string[] {
  return Object.freeze(
    attestation.capabilities.filter(
      (capability) =>
        capability.startsWith("deployment.") &&
        capability.endsWith(".read")
    )
  );
}

export class VercelProjectAuthorizationService {
  readonly #projects: PersistentProjectRegistry;
  readonly #connections: PersistentConnectionRegistry;
  readonly #bindings:
    PersistentProjectConnectionBindingRegistry;
  readonly #delegations: DelegationService;
  readonly #attestor: ExternalConnectionAttestor;

  constructor(
    options: VercelProjectAuthorizationServiceOptions
  ) {
    this.#projects = options.projects;
    this.#connections = options.connections;
    this.#bindings = options.bindings;
    this.#delegations = options.delegations;
    this.#attestor = options.attestor;
  }

  async syncConnections(
    principalId: string
  ): Promise<readonly Connection[]> {
    await this.#connections
      .assertPrincipalCanAdminister(principalId);

    const discovered =
      await this.#attestor.listConnections();
    const existing =
      await this.#connections.listByProvider(
        this.#connections.accountDomainId,
        "vercel"
      );
    const discoveredProviderIds = new Set(
      discovered.map(
        (item) =>
          "installation:" +
          item.connectionReference
      )
    );

    for (const item of discovered) {
      const providerAccountId =
        "installation:" +
        item.connectionReference;
      const current = existing.find(
        (connection) =>
          connection.providerAccountId ===
          providerAccountId
      );

      if (current?.status === "revoked") {
        continue;
      }

      if (current) {
        await this.#connections.verify(
          current.connectionId,
          {
            status: "active",
            capabilities:
              current.capabilities,
            verifiedAt: item.observedAt
          }
        );
        continue;
      }

      await this.#connections.register({
        authorizedByPrincipalId: principalId,
        accountDomainId:
          this.#connections.accountDomainId,
        provider: "vercel",
        providerAccountId,
        providerDisplayName:
          item.accountDisplayName,
        label:
          "Vercel " +
          item.accountDisplayName,
        authenticationStrategy:
          "delegated_service",
        capabilities: [],
        createdAt: item.connectedAt,
        verifiedAt: item.observedAt
      });
    }

    for (const connection of existing) {
      if (
        connection.authenticationStrategy !==
          "delegated_service" ||
        connection.status === "revoked" ||
        discoveredProviderIds.has(
          connection.providerAccountId
        )
      ) {
        continue;
      }

      await this.#connections.setStatus(
        connection.connectionId,
        "reconnect_required"
      );
    }

    return this.#connections.listByProvider(
      this.#connections.accountDomainId,
      "vercel"
    );
  }

  async #attest(
    principalId: string,
    project: Project,
    connection: Connection,
    requiredCapabilities: readonly string[]
  ): Promise<ExternalRepositoryAttestation> {
    if (!project.accountDomainId) {
      throw new VercelProjectAuthorizationError(
        "Project " + project.projectId +
        " has no AccountDomain assignment."
      );
    }
    if (
      connection.accountDomainId !==
      project.accountDomainId
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel Connection and Project belong to different AccountDomains."
      );
    }
    if (connection.status !== "active") {
      throw new VercelProjectAuthorizationError(
        "Vercel Connection is not active."
      );
    }

    const repository =
      canonicalRepository(project);
    const reference =
      connectionReference(connection);
    const attestation =
      await this.#attestor.attestRepository({
        connectionReference: reference,
        repository,
        principalId,
        accountDomainId:
          project.accountDomainId
      });

    if (
      attestation.connectionReference !==
      reference
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel attestation does not match the Connection."
      );
    }
    if (
      !sameRepository(
        attestation.repository,
        repository
      )
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel attestation does not match the Project repository."
      );
    }

    requireResource(attestation);
    requireCapabilities(
      attestation,
      requiredCapabilities
    );

    await this.#connections.verify(
      connection.connectionId,
      {
        status: "active",
        capabilities:
          attestation.capabilities,
        verifiedAt:
          attestation.verifiedAt
      }
    );

    return attestation;
  }

  async bindProject(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly connectionId: string;
    readonly executionCapability?: string;
  }): Promise<BoundVercelProject> {
    await this.#connections
      .assertPrincipalCanAdminister(
        input.principalId
      );

    const project =
      await this.#projects.get(input.projectId);
    if (!project) {
      throw new VercelProjectAuthorizationError(
        "Unknown Project: " + input.projectId
      );
    }

    const connection =
      await this.#connections.get(
        input.connectionId
      );
    if (!connection) {
      throw new VercelProjectAuthorizationError(
        "Unknown Connection: " +
        input.connectionId
      );
    }

    const executionCapability =
      input.executionCapability?.trim();
    if (
      executionCapability &&
      !executionCapability.endsWith(".write")
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel execution capability must be an explicit write capability."
      );
    }

    const required = [
      "deployment.read",
      ...(executionCapability
        ? [executionCapability]
        : [])
    ];
    const attestation = await this.#attest(
      input.principalId,
      project,
      connection,
      required
    );
    const resource =
      requireResource(attestation);
    const reads =
      readCapabilities(attestation);
    if (!reads.includes("deployment.read")) {
      throw new VercelProjectAuthorizationError(
        "Vercel attestation must include deployment.read."
      );
    }

    const bindingInputs = [
      ...reads.map((capability) => ({
        projectId: project.projectId,
        connectionId:
          connection.connectionId,
        capabilityScope: {
          kind: "exact" as const,
          value: capability
        },
        resource,
        selection: "explicit" as const
      })),
      ...(executionCapability
        ? [{
            projectId: project.projectId,
            connectionId:
              connection.connectionId,
            capabilityScope: {
              kind: "exact" as const,
              value: executionCapability
            },
            resource,
            selection:
              "explicit" as const,
            approvalRequiredFor:
              ["mutate" as const]
          }]
        : [])
    ];

    const bindings =
      await Promise.all(
        bindingInputs.map((binding) =>
          this.#bindings.register(binding)
        )
      );

    return Object.freeze({
      projectId: project.projectId,
      repository:
        canonicalRepository(project),
      connectionId:
        connection.connectionId,
      attestation,
      bindings: Object.freeze(bindings)
    });
  }

  async issueConductorDelegation(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly capabilityId: string;
    readonly effectClass: EffectClass;
    readonly approvalReference?: string;
    readonly expiresInSeconds?: number;
  }): Promise<IssuedDelegation> {
    const capabilityId =
      input.capabilityId.trim();
    if (!capabilityId) {
      throw new VercelProjectAuthorizationError(
        "Vercel capability is required."
      );
    }

    const expectedEffect =
      expectedEffectClass(capabilityId);
    await this.#delegations
      .assertPrincipalProjectAccess(
        input.principalId,
        input.projectId,
        expectedEffect
      );
    if (input.effectClass !== expectedEffect) {
      throw new VercelProjectAuthorizationError(
        "Vercel capability " + capabilityId +
        " requires effect class " + expectedEffect + "."
      );
    }

    if (
      input.effectClass === "mutate" &&
      !input.approvalReference?.trim()
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel mutation delegation requires an approval reference."
      );
    }

    const project =
      await this.#projects.get(input.projectId);
    if (!project) {
      throw new VercelProjectAuthorizationError(
        "Unknown Project: " +
        input.projectId
      );
    }

    const resolution =
      await this.#bindings.resolve({
        projectId: input.projectId,
        capabilityId
      });
    if (
      resolution.status !== "available" ||
      !resolution.binding ||
      !resolution.connection
    ) {
      throw new VercelProjectAuthorizationError(
        resolution.reason ??
        "Vercel Project binding is unavailable."
      );
    }

    const attestation = await this.#attest(
      input.principalId,
      project,
      resolution.connection,
      [capabilityId]
    );
    const attestedResource =
      requireResource(attestation);
    const boundResource =
      resolution.binding.resource;
    if (
      !boundResource ||
      boundResource.kind !==
        attestedResource.kind ||
      boundResource.value !==
        attestedResource.value
    ) {
      throw new VercelProjectAuthorizationError(
        "Vercel project identity changed since binding."
      );
    }

    return this.#delegations.issue({
      principalId: input.principalId,
      projectId: input.projectId,
      capabilityId,
      effectClass: input.effectClass,
      audience: "conductor",
      ...(input.approvalReference?.trim()
        ? {
            approvalReference:
              input.approvalReference.trim()
          }
        : {}),
      ...(input.expiresInSeconds
        ? {
            expiresInSeconds:
              input.expiresInSeconds
          }
        : {})
    });
  }
}
