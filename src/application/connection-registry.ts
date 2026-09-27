import { createHash } from "node:crypto";

import type {
  AuthenticationStrategy,
  Connection,
  ConnectionStatus
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";

export interface RegisterConnectionInput {
  readonly connectionId?: string;
  readonly ownerId: string;
  readonly accountDomainId: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly providerDisplayName?: string;
  readonly label?: string;
  readonly environment?: string;
  readonly authenticationStrategy: AuthenticationStrategy;
  readonly capabilities?: readonly string[];
  readonly createdAt?: string;
  readonly verifiedAt?: string;
}

export class ConnectionIdentityConflictError extends Error {
  readonly code = "connection_identity_conflict";

  constructor(message: string) {
    super(message);
    this.name = "ConnectionIdentityConflictError";
  }
}

function normalizedProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) throw new Error("Connection provider cannot be empty.");
  return normalized;
}

function normalizedEnvironment(environment: string | undefined): string | undefined {
  const normalized = environment?.trim().toLowerCase();
  return normalized || undefined;
}

function connectionIdentityKey(input: {
  readonly accountDomainId: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly environment?: string;
}): string {
  return [
    input.accountDomainId.trim(),
    normalizedProvider(input.provider),
    input.providerAccountId.trim(),
    normalizedEnvironment(input.environment) ?? "default"
  ].join("\u0000");
}

function generatedConnectionId(identityKey: string, provider: string): string {
  const digest = createHash("sha256").update(identityKey).digest("hex").slice(0, 20);
  return `connection:${normalizedProvider(provider)}:${digest}`;
}

function normalizedCapabilities(capabilities: readonly string[] | undefined): readonly string[] {
  return Object.freeze(
    [...new Set((capabilities ?? []).map((value) => value.trim()).filter(Boolean))].sort()
  );
}

function freezeConnection(connection: Connection): Connection {
  return Object.freeze({
    ...connection,
    capabilities: Object.freeze([...connection.capabilities])
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryConnectionRegistry {
  readonly #connections = new Map<string, Connection>();
  readonly #identity = new Map<string, string>();

  constructor(connections: readonly Connection[] = []) {
    for (const connection of connections) this.#index(freezeConnection(connection));
  }

  #index(connection: Connection): void {
    const existingById = this.#connections.get(connection.connectionId);
    if (existingById && existingById !== connection) {
      throw new ConnectionIdentityConflictError(
        `Duplicate connection ID: ${connection.connectionId}`
      );
    }

    const key = connectionIdentityKey(connection);
    const existingByIdentity = this.#identity.get(key);
    if (existingByIdentity && existingByIdentity !== connection.connectionId) {
      throw new ConnectionIdentityConflictError(
        `Provider identity already belongs to connection ${existingByIdentity}.`
      );
    }

    this.#connections.set(connection.connectionId, connection);
    this.#identity.set(key, connection.connectionId);
  }

  #replace(connection: Connection): Connection {
    const frozen = freezeConnection(connection);
    this.#connections.set(frozen.connectionId, frozen);
    this.#identity.set(connectionIdentityKey(frozen), frozen.connectionId);
    return frozen;
  }

  listConnections(): readonly Connection[] {
    return Object.freeze(
      [...this.#connections.values()].sort((left, right) =>
        left.connectionId.localeCompare(right.connectionId)
      )
    );
  }

  get(connectionId: string): Connection | undefined {
    return this.#connections.get(connectionId);
  }

  listByProvider(accountDomainId: string, provider: string): readonly Connection[] {
    const normalized = normalizedProvider(provider);
    return Object.freeze(
      this.listConnections().filter(
        (connection) =>
          connection.accountDomainId === accountDomainId &&
          connection.provider === normalized
      )
    );
  }

  register(input: RegisterConnectionInput): Connection {
    const provider = normalizedProvider(input.provider);
    const providerAccountId = input.providerAccountId.trim();
    const accountDomainId = input.accountDomainId.trim();
    const ownerId = input.ownerId.trim();
    if (!providerAccountId) throw new Error("Provider account identity cannot be empty.");
    if (!accountDomainId) throw new Error("Account domain cannot be empty.");
    if (!ownerId) throw new Error("Owner identity cannot be empty.");

    const environment = normalizedEnvironment(input.environment);
    const key = connectionIdentityKey({
      accountDomainId,
      provider,
      providerAccountId,
      ...(environment ? { environment } : {})
    });
    const existingId = this.#identity.get(key);

    if (existingId) {
      if (input.connectionId && input.connectionId !== existingId) {
        throw new ConnectionIdentityConflictError(
          `Provider identity already belongs to ${existingId}, not ${input.connectionId}.`
        );
      }

      const existing = this.#connections.get(existingId)!;
      const updatedAt = input.verifiedAt ?? nowIso();
      return this.#replace({
        ...existing,
        ownerId,
        provider,
        providerAccountId,
        ...(input.providerDisplayName !== undefined
          ? { providerDisplayName: input.providerDisplayName }
          : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(environment ? { environment } : {}),
        authenticationStrategy: input.authenticationStrategy,
        status: "active",
        capabilities: normalizedCapabilities(input.capabilities ?? existing.capabilities),
        updatedAt,
        lastVerifiedAt: input.verifiedAt ?? updatedAt,
        revokedAt: undefined
      });
    }

    const createdAt = input.createdAt ?? nowIso();
    const connection = freezeConnection({
      connectionId: input.connectionId ?? generatedConnectionId(key, provider),
      ownerId,
      accountDomainId,
      provider,
      providerAccountId,
      ...(input.providerDisplayName !== undefined
        ? { providerDisplayName: input.providerDisplayName }
        : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(environment ? { environment } : {}),
      authenticationStrategy: input.authenticationStrategy,
      status: "active",
      capabilities: normalizedCapabilities(input.capabilities),
      createdAt,
      updatedAt: input.verifiedAt ?? createdAt,
      lastVerifiedAt: input.verifiedAt ?? createdAt
    });

    this.#index(connection);
    return connection;
  }

  setStatus(
    connectionId: string,
    status: ConnectionStatus,
    at = nowIso()
  ): Connection {
    const connection = this.#connections.get(connectionId);
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);

    return this.#replace({
      ...connection,
      status,
      updatedAt: at,
      ...(status === "revoked" ? { revokedAt: at } : { revokedAt: undefined })
    });
  }

  reconnect(
    connectionId: string,
    options: {
      readonly capabilities?: readonly string[];
      readonly verifiedAt?: string;
    } = {}
  ): Connection {
    const connection = this.#connections.get(connectionId);
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);

    const verifiedAt = options.verifiedAt ?? nowIso();
    return this.#replace({
      ...connection,
      status: "active",
      capabilities: normalizedCapabilities(options.capabilities ?? connection.capabilities),
      updatedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
      revokedAt: undefined
    });
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export class PersistentConnectionRegistry {
  readonly #store: ControlRegistryStore;

  constructor(store: ControlRegistryStore) {
    this.#store = store;
  }

  async listConnections(): Promise<readonly Connection[]> {
    const snapshot = await this.#store.load();
    return new InMemoryConnectionRegistry(snapshot.connections).listConnections();
  }

  async get(connectionId: string): Promise<Connection | undefined> {
    const snapshot = await this.#store.load();
    return new InMemoryConnectionRegistry(snapshot.connections).get(connectionId);
  }

  async listByProvider(
    accountDomainId: string,
    provider: string
  ): Promise<readonly Connection[]> {
    const snapshot = await this.#store.load();
    return new InMemoryConnectionRegistry(snapshot.connections).listByProvider(
      accountDomainId,
      provider
    );
  }

  async register(input: RegisterConnectionInput): Promise<Connection> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryConnectionRegistry(snapshot.connections);
      const before = stableJson(registry.listConnections());
      const result = registry.register(input);
      const connections = registry.listConnections();
      return {
        result,
        projects: snapshot.projects,
        connections,
        changed: before !== stableJson(connections)
      };
    });
  }

  async setStatus(
    connectionId: string,
    status: ConnectionStatus,
    at?: string
  ): Promise<Connection> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryConnectionRegistry(snapshot.connections);
      const before = stableJson(registry.listConnections());
      const result = registry.setStatus(connectionId, status, at);
      const connections = registry.listConnections();
      return {
        result,
        projects: snapshot.projects,
        connections,
        changed: before !== stableJson(connections)
      };
    });
  }

  async reconnect(
    connectionId: string,
    options: {
      readonly capabilities?: readonly string[];
      readonly verifiedAt?: string;
    } = {}
  ): Promise<Connection> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryConnectionRegistry(snapshot.connections);
      const before = stableJson(registry.listConnections());
      const result = registry.reconnect(connectionId, options);
      const connections = registry.listConnections();
      return {
        result,
        projects: snapshot.projects,
        connections,
        changed: before !== stableJson(connections)
      };
    });
  }
}
