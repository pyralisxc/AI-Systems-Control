import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Connection } from "../domain/index.js";
import type {
  AuthorizationFlow,
  AuthorizationFlowStore,
  ConnectionAuthorizationProvider
} from "../ports/index.js";
import { PersistentConnectionRegistry } from "./connection-registry.js";

export interface BeginConnectionFlowInput {
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly provider: string;
  readonly callbackUrl: string;
  readonly expiresInSeconds?: number;
  readonly now?: string;
}

export interface BegunConnectionFlow {
  readonly flowId: string;
  readonly state: string;
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

export interface CompleteConnectionFlowInput {
  readonly flowId: string;
  readonly state: string;
  readonly callback: Readonly<Record<string, string>>;
  readonly now?: string;
}

export class ConnectionAuthorizationError extends Error {
  readonly code = "connection_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name = "ConnectionAuthorizationError";
  }
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function parseIso(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ConnectionAuthorizationError(label + " must be a valid ISO timestamp.");
  }
  return parsed;
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (!normalized) throw new ConnectionAuthorizationError("Provider is required.");
  return normalized;
}

function identityInput(connection: Connection) {
  return {
    principalId: connection.principalId,
    accountDomainId: connection.accountDomainId,
    providerAccountId: connection.providerAccountId,
    ...(connection.environment ? { environment: connection.environment } : {})
  };
}

export class InMemoryAuthorizationFlowStore implements AuthorizationFlowStore {
  readonly #flows = new Map<string, AuthorizationFlow>();

  async create(input: { readonly flow: AuthorizationFlow }): Promise<void> {
    if (this.#flows.has(input.flow.flowId)) {
      throw new ConnectionAuthorizationError(
        "Authorization flow already exists: " + input.flow.flowId
      );
    }
    this.#flows.set(input.flow.flowId, Object.freeze({ ...input.flow }));
  }

  async get(flowId: string): Promise<AuthorizationFlow | undefined> {
    return this.#flows.get(flowId);
  }

  async consume(input: {
    readonly flowId: string;
    readonly stateHash: string;
    readonly now: string;
  }): Promise<AuthorizationFlow> {
    const flow = this.#flows.get(input.flowId);
    if (!flow) throw new ConnectionAuthorizationError("Unknown authorization flow.");
    if (flow.state !== "pending") {
      throw new ConnectionAuthorizationError("Authorization flow has already been consumed.");
    }

    const nowMs = parseIso(input.now, "Authorization flow consume time");
    if (Date.parse(flow.expiresAt) <= nowMs) {
      throw new ConnectionAuthorizationError("Authorization flow has expired.");
    }
    if (flow.stateHash !== input.stateHash) {
      throw new ConnectionAuthorizationError("Authorization state does not match.");
    }

    const consumed = Object.freeze({
      ...flow,
      state: "consumed" as const,
      consumedAt: input.now
    });
    this.#flows.set(flow.flowId, consumed);
    return consumed;
  }
}

export class ConnectionAuthorizationBroker {
  readonly #flows: AuthorizationFlowStore;
  readonly #connections: PersistentConnectionRegistry;
  readonly #providers = new Map<string, ConnectionAuthorizationProvider>();

  constructor(input: {
    readonly flowStore: AuthorizationFlowStore;
    readonly connections: PersistentConnectionRegistry;
    readonly providers: readonly ConnectionAuthorizationProvider[];
  }) {
    this.#flows = input.flowStore;
    this.#connections = input.connections;

    for (const provider of input.providers) {
      const key = normalizeProvider(provider.provider);
      if (this.#providers.has(key)) {
        throw new ConnectionAuthorizationError("Duplicate provider adapter: " + key);
      }
      this.#providers.set(key, provider);
    }
  }

  #provider(provider: string): ConnectionAuthorizationProvider {
    const key = normalizeProvider(provider);
    const adapter = this.#providers.get(key);
    if (!adapter) {
      throw new ConnectionAuthorizationError("No authorization adapter for provider: " + key);
    }
    return adapter;
  }

  async begin(input: BeginConnectionFlowInput): Promise<BegunConnectionFlow> {
    const principalId = input.principalId.trim();
    const accountDomainId = input.accountDomainId.trim();
    const callbackUrl = input.callbackUrl.trim();
    if (!principalId) throw new ConnectionAuthorizationError("Principal is required.");
    if (!accountDomainId) throw new ConnectionAuthorizationError("AccountDomain is required.");
    if (accountDomainId !== this.#connections.accountDomainId) {
      throw new ConnectionAuthorizationError(
        "Authorization AccountDomain " + accountDomainId +
        " does not match registry " + this.#connections.accountDomainId + "."
      );
    }
    if (!callbackUrl) throw new ConnectionAuthorizationError("Callback URL is required.");

    const ttl = input.expiresInSeconds ?? 600;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 1800) {
      throw new ConnectionAuthorizationError(
        "Authorization flow TTL must be between 30 and 1800 seconds."
      );
    }

    const provider = normalizeProvider(input.provider);
    const adapter = this.#provider(provider);
    const createdAt = input.now ?? new Date().toISOString();
    const createdAtMs = parseIso(createdAt, "Authorization flow start time");
    const expiresAt = new Date(createdAtMs + ttl * 1000).toISOString();
    const flowId = "authflow:" + randomUUID();
    const state = randomBytes(32).toString("base64url");

    const begun = await adapter.beginAuthorization({
      flowId,
      principalId,
      accountDomainId,
      state,
      callbackUrl
    });

    const flow: AuthorizationFlow = Object.freeze({
      flowId,
      principalId,
      accountDomainId,
      provider,
      stateHash: hashState(state),
      callbackUrl,
      ...(begun.providerFlowReference
        ? { providerFlowReference: begun.providerFlowReference }
        : {}),
      createdAt,
      expiresAt,
      state: "pending"
    });
    await this.#flows.create({ flow });

    return Object.freeze({
      flowId,
      state,
      authorizationUrl: begun.authorizationUrl,
      expiresAt
    });
  }

  async complete(input: CompleteConnectionFlowInput): Promise<Connection> {
    const now = input.now ?? new Date().toISOString();
    const flow = await this.#flows.consume({
      flowId: input.flowId,
      stateHash: hashState(input.state),
      now
    });

    const adapter = this.#provider(flow.provider);
    const metadata = await adapter.completeAuthorization({
      flowId: flow.flowId,
      principalId: flow.principalId,
      accountDomainId: flow.accountDomainId,
      callback: input.callback,
      ...(flow.providerFlowReference
        ? { providerFlowReference: flow.providerFlowReference }
        : {})
    });

    return this.#connections.register({
      principalId: flow.principalId,
      accountDomainId: flow.accountDomainId,
      provider: flow.provider,
      providerAccountId: metadata.providerAccountId,
      ...(metadata.providerDisplayName
        ? { providerDisplayName: metadata.providerDisplayName }
        : {}),
      ...(metadata.label ? { label: metadata.label } : {}),
      ...(metadata.environment ? { environment: metadata.environment } : {}),
      authenticationStrategy: metadata.authenticationStrategy,
      capabilities: metadata.capabilities,
      verifiedAt: now
    });
  }

  async verify(connectionId: string, now = new Date().toISOString()): Promise<Connection> {
    const connection = await this.#connections.get(connectionId);
    if (!connection) throw new ConnectionAuthorizationError("Unknown connection: " + connectionId);

    const adapter = this.#provider(connection.provider);
    const verified = await adapter.verifyAuthorization(identityInput(connection));

    return this.#connections.verify(connection.connectionId, {
      status: verified.status,
      capabilities: verified.capabilities,
      verifiedAt: verified.verifiedAt || now
    });
  }

  async revoke(connectionId: string, now = new Date().toISOString()): Promise<Connection> {
    const connection = await this.#connections.get(connectionId);
    if (!connection) throw new ConnectionAuthorizationError("Unknown connection: " + connectionId);

    const adapter = this.#provider(connection.provider);
    await adapter.revokeAuthorization(identityInput(connection));
    return this.#connections.setStatus(connection.connectionId, "revoked", now);
  }
}
