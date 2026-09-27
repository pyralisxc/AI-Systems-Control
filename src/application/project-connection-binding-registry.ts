import { createHash } from "node:crypto";

import type {
  Connection,
  EffectClass,
  ProjectConnectionBinding,
  ProjectConnectionBindingStatus,
  ProviderResourceReference
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";

export interface RegisterProjectConnectionBindingInput {
  readonly bindingId?: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly workspaceId?: string;
  readonly environment?: string;
  readonly capabilityScope: {
    readonly kind: "exact" | "prefix";
    readonly value: string;
  };
  readonly resource?: ProviderResourceReference;
  readonly selection?: "default" | "explicit";
  readonly approvalRequiredFor?: readonly EffectClass[];
  readonly createdAt?: string;
}

export interface ResolveProjectConnectionInput {
  readonly projectId: string;
  readonly capabilityId: string;
  readonly workspaceId?: string;
  readonly environment?: string;
}

export interface ProjectConnectionResolution {
  readonly status: "available" | "unavailable" | "permission_blocked" | "ambiguous";
  readonly binding?: ProjectConnectionBinding;
  readonly connection?: Connection;
  readonly reason?: string;
  readonly candidateBindingIds: readonly string[];
}

export class ProjectConnectionBindingConflictError extends Error {
  readonly code = "project_connection_binding_conflict";

  constructor(message: string) {
    super(message);
    this.name = "ProjectConnectionBindingConflictError";
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeCapabilityScope(input: RegisterProjectConnectionBindingInput["capabilityScope"]) {
  const value = input.value.trim();
  if (!value) throw new Error("Capability scope cannot be empty.");
  return Object.freeze({ kind: input.kind, value });
}

function normalizeApprovalRequiredFor(values: readonly EffectClass[] | undefined): readonly EffectClass[] {
  return Object.freeze([...new Set(values ?? [])].sort());
}

function generatedBindingId(input: RegisterProjectConnectionBindingInput): string {
  const fingerprint = JSON.stringify({
    projectId: input.projectId,
    connectionId: input.connectionId,
    workspaceId: normalizeOptional(input.workspaceId) ?? null,
    environment: normalizeOptional(input.environment) ?? null,
    capabilityScope: normalizeCapabilityScope(input.capabilityScope),
    resource: input.resource ?? null
  });
  return "project-connection:" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 24);
}

function withoutRevokedAt(binding: ProjectConnectionBinding): ProjectConnectionBinding {
  const { revokedAt: _revokedAt, ...rest } = binding;
  return rest;
}

function capabilityMatches(scope: ProjectConnectionBinding["capabilityScope"], capabilityId: string): boolean {
  if (scope.kind === "exact") return scope.value === capabilityId;
  return capabilityId.startsWith(scope.value);
}

function connectionSupports(connection: Connection, capabilityId: string): boolean {
  return connection.capabilities.some((value) => {
    if (value === "*" || value === capabilityId) return true;
    if (value.endsWith(".*")) return capabilityId.startsWith(value.slice(0, -1));
    return false;
  });
}

function specificity(
  binding: ProjectConnectionBinding,
  request: ResolveProjectConnectionInput
): number {
  let score = binding.capabilityScope.kind === "exact"
    ? 100
    : 10 + binding.capabilityScope.value.length;
  if (binding.environment && normalizeOptional(binding.environment) === normalizeOptional(request.environment)) {
    score += 20;
  }
  if (binding.workspaceId && binding.workspaceId === request.workspaceId) score += 40;
  return score;
}

function freezeBinding(binding: ProjectConnectionBinding): ProjectConnectionBinding {
  return Object.freeze({
    ...binding,
    capabilityScope: Object.freeze({ ...binding.capabilityScope }),
    ...(binding.resource ? { resource: Object.freeze({ ...binding.resource }) } : {}),
    approvalRequiredFor: Object.freeze([...binding.approvalRequiredFor])
  });
}

export class InMemoryProjectConnectionBindingRegistry {
  readonly #bindings = new Map<string, ProjectConnectionBinding>();

  constructor(bindings: readonly ProjectConnectionBinding[] = []) {
    for (const binding of bindings) {
      if (this.#bindings.has(binding.bindingId)) {
        throw new ProjectConnectionBindingConflictError("Duplicate binding ID: " + binding.bindingId);
      }
      this.#bindings.set(binding.bindingId, freezeBinding(binding));
    }
  }

  listBindings(): readonly ProjectConnectionBinding[] {
    return Object.freeze(
      [...this.#bindings.values()].sort((left, right) => left.bindingId.localeCompare(right.bindingId))
    );
  }

  get(bindingId: string): ProjectConnectionBinding | undefined {
    return this.#bindings.get(bindingId);
  }

  register(input: RegisterProjectConnectionBindingInput): ProjectConnectionBinding {
    const bindingId = input.bindingId ?? generatedBindingId(input);
    const existing = this.#bindings.get(bindingId);
    const now = input.createdAt ?? new Date().toISOString();
    const environment = normalizeOptional(input.environment);
    const binding = freezeBinding({
      bindingId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(environment ? { environment } : {}),
      capabilityScope: normalizeCapabilityScope(input.capabilityScope),
      ...(input.resource ? { resource: Object.freeze({ ...input.resource }) } : {}),
      selection: input.selection ?? "explicit",
      approvalRequiredFor: normalizeApprovalRequiredFor(input.approvalRequiredFor),
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });

    this.#bindings.set(bindingId, binding);
    return binding;
  }

  setStatus(
    bindingId: string,
    status: ProjectConnectionBindingStatus,
    at = new Date().toISOString()
  ): ProjectConnectionBinding {
    const binding = this.#bindings.get(bindingId);
    if (!binding) throw new Error("Unknown project connection binding: " + bindingId);

    const updated = status === "revoked"
      ? freezeBinding({ ...binding, status, updatedAt: at, revokedAt: at })
      : freezeBinding({ ...withoutRevokedAt(binding), status, updatedAt: at });
    this.#bindings.set(bindingId, updated);
    return updated;
  }

  resolve(
    request: ResolveProjectConnectionInput,
    connections: readonly Connection[]
  ): ProjectConnectionResolution {
    const environment = normalizeOptional(request.environment);
    const candidates = this.listBindings().filter((binding) => {
      if (binding.status !== "active" || binding.projectId !== request.projectId) return false;
      if (binding.workspaceId && binding.workspaceId !== request.workspaceId) return false;
      if (binding.environment && normalizeOptional(binding.environment) !== environment) return false;
      if (!request.environment && binding.environment) return false;
      return capabilityMatches(binding.capabilityScope, request.capabilityId);
    });

    if (candidates.length === 0) {
      return Object.freeze({
        status: "unavailable",
        reason: "No Project connection binding matches " + request.projectId + " / " + request.capabilityId + ".",
        candidateBindingIds: Object.freeze([])
      });
    }

    const bestScore = Math.max(...candidates.map((candidate) => specificity(candidate, request)));
    const best = candidates.filter((candidate) => specificity(candidate, request) === bestScore);
    const connectionMap = new Map(connections.map((connection) => [connection.connectionId, connection]));

    const evaluated = best.map((binding) => ({
      binding,
      connection: connectionMap.get(binding.connectionId)
    }));

    const available = evaluated.filter(({ connection }) =>
      Boolean(connection && connection.status === "active" && connectionSupports(connection, request.capabilityId))
    );

    if (available.length > 1) {
      return Object.freeze({
        status: "ambiguous",
        reason: available.length + " equally specific active bindings match; explicit resolution is required.",
        candidateBindingIds: Object.freeze(available.map(({ binding }) => binding.bindingId))
      });
    }

    if (available.length === 1) {
      const resolved = available[0]!;
      return Object.freeze({
        status: "available",
        binding: resolved.binding,
        connection: resolved.connection!,
        candidateBindingIds: Object.freeze([resolved.binding.bindingId])
      });
    }

    const permissionBlocked = evaluated.find(({ connection }) =>
      Boolean(connection && connection.status === "active" && !connectionSupports(connection, request.capabilityId))
    );
    if (permissionBlocked) {
      return Object.freeze({
        status: "permission_blocked",
        binding: permissionBlocked.binding,
        connection: permissionBlocked.connection!,
        reason: "Connection " + permissionBlocked.connection!.connectionId +
          " does not advertise capability " + request.capabilityId + ".",
        candidateBindingIds: Object.freeze(best.map((binding) => binding.bindingId))
      });
    }

    return Object.freeze({
      status: "unavailable",
      reason: "The most specific matching connection is unavailable or revoked; ASC will not fall back implicitly.",
      candidateBindingIds: Object.freeze(best.map((binding) => binding.bindingId))
    });
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export class PersistentProjectConnectionBindingRegistry {
  readonly #store: ControlRegistryStore;

  constructor(store: ControlRegistryStore) {
    this.#store = store;
  }

  async listBindings(): Promise<readonly ProjectConnectionBinding[]> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectConnectionBindingRegistry(snapshot.projectConnectionBindings).listBindings();
  }

  async register(input: RegisterProjectConnectionBindingInput): Promise<ProjectConnectionBinding> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      if (!snapshot.projects.some((project) => project.projectId === input.projectId)) {
        throw new Error("Unknown project: " + input.projectId);
      }
      if (!snapshot.connections.some((connection) => connection.connectionId === input.connectionId)) {
        throw new Error("Unknown connection: " + input.connectionId);
      }

      const registry = new InMemoryProjectConnectionBindingRegistry(snapshot.projectConnectionBindings);
      const before = stableJson(registry.listBindings());
      const result = registry.register(input);
      const projectConnectionBindings = registry.listBindings();
      return {
        result,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings,
        delegations: snapshot.delegations,
        changed: before !== stableJson(projectConnectionBindings)
      };
    });
  }

  async setStatus(
    bindingId: string,
    status: ProjectConnectionBindingStatus,
    at?: string
  ): Promise<ProjectConnectionBinding> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryProjectConnectionBindingRegistry(snapshot.projectConnectionBindings);
      const before = stableJson(registry.listBindings());
      const result = registry.setStatus(bindingId, status, at);
      const projectConnectionBindings = registry.listBindings();
      return {
        result,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings,
        delegations: snapshot.delegations,
        changed: before !== stableJson(projectConnectionBindings)
      };
    });
  }

  async resolve(request: ResolveProjectConnectionInput): Promise<ProjectConnectionResolution> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectConnectionBindingRegistry(snapshot.projectConnectionBindings)
      .resolve(request, snapshot.connections);
  }
}
