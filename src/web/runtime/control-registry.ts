import { createHash } from "node:crypto";

import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore,
  PostgresControlRegistryStore,
  PostgresIdentityDirectoryStore
} from "../../../dist/adapters/index.js";
import {
  ContinuationAuthorityService,
  PersistentConnectionRegistry,
  PersistentIdentityRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry,
  WorkerAuthorityService
} from "../../../dist/application/index.js";
import type {
  ControlRegistryStore,
  IdentityDirectoryStore
} from "../../../dist/ports/index.js";

let cachedIdentityDatabaseUrl: string | undefined;
let cachedIdentityStore: PostgresIdentityDirectoryStore | undefined;
const postgresControlStores = new Map<string, PostgresControlRegistryStore>();

export function controlRegistryPath(): string | null {
  const value = process.env.ASC_CONTROL_REGISTRY_PATH?.trim();
  return value || null;
}

export function controlRegistryDatabaseUrl(): string | null {
  const value = process.env.ASC_CONTROL_REGISTRY_DATABASE_URL?.trim();
  return value || null;
}

export function defaultAccountDomainId(): string {
  return process.env.ASC_DEFAULT_ACCOUNT_DOMAIN_ID?.trim() || "domain:personal";
}

export function defaultAccountDomainName(): string {
  return process.env.ASC_DEFAULT_ACCOUNT_DOMAIN_NAME?.trim() || "Personal";
}

export function bootstrapPrincipalId(): string {
  return process.env.ASC_BOOTSTRAP_PRINCIPAL_ID?.trim() || "principal:owner";
}

export function bootstrapPrincipalName(): string {
  return process.env.ASC_BOOTSTRAP_PRINCIPAL_NAME?.trim() || "Owner";
}

export function resolvedPersonalPrincipalId(): string | null {
  return personalBootstrapEnabled() ? bootstrapPrincipalId() : null;
}

export function controlRegistryConfigured(): boolean {
  return Boolean(controlRegistryDatabaseUrl() || controlRegistryPath());
}

export function personalBootstrapEnabled(): boolean {
  return process.env.ASC_PERSONAL_BOOTSTRAP_ENABLED?.trim().toLowerCase() !== "false";
}

function requiredAccountDomainId(accountDomainId: string): string {
  const normalized = accountDomainId.trim();
  if (!normalized) {
    throw new Error("AccountDomain context is required.");
  }
  return normalized;
}

function localTenantSuffix(accountDomainId: string): string {
  return createHash("sha256")
    .update(accountDomainId)
    .digest("hex")
    .slice(0, 20);
}

function identityDirectoryStore(): IdentityDirectoryStore {
  const databaseUrl = controlRegistryDatabaseUrl();
  if (databaseUrl) {
    if (!cachedIdentityStore || cachedIdentityDatabaseUrl !== databaseUrl) {
      cachedIdentityStore =
        PostgresIdentityDirectoryStore.fromConnectionString(databaseUrl);
      cachedIdentityDatabaseUrl = databaseUrl;
    }
    return cachedIdentityStore;
  }

  const path = controlRegistryPath();
  if (path) return new JsonFileIdentityDirectoryStore(path + ".identity");

  throw new Error(
    "ASC identity directory storage is not configured."
  );
}

export function controlRegistryStoreForDomain(
  accountDomainIdInput: string
): ControlRegistryStore {
  const accountDomainId = requiredAccountDomainId(accountDomainIdInput);
  const databaseUrl = controlRegistryDatabaseUrl();
  if (databaseUrl) {
    const cacheKey = databaseUrl + "\u0000" + accountDomainId;
    const existing = postgresControlStores.get(cacheKey);
    if (existing) return existing;

    const store = PostgresControlRegistryStore.fromConnectionString(
      databaseUrl,
      accountDomainId
    );
    postgresControlStores.set(cacheKey, store);
    return store;
  }

  const path = controlRegistryPath();
  if (path) {
    if (accountDomainId === defaultAccountDomainId()) {
      return new JsonFileControlRegistryStore(path, accountDomainId);
    }
    return new JsonFileControlRegistryStore(
      path + ".domain-" + localTenantSuffix(accountDomainId),
      accountDomainId
    );
  }

  throw new Error(
    "ASC control registry storage is not configured. Set ASC_CONTROL_REGISTRY_DATABASE_URL " +
    "for PostgreSQL or ASC_CONTROL_REGISTRY_PATH for a persistent local volume."
  );
}

function bootstrapAuthenticationIdentity():
  | { readonly issuer: string; readonly subject: string }
  | undefined {
  const issuer = process.env.ASC_BOOTSTRAP_AUTH_ISSUER?.trim();
  const subject = process.env.ASC_BOOTSTRAP_AUTH_SUBJECT?.trim();

  if (!issuer && !subject) return undefined;
  if (!issuer || !subject) {
    throw new Error(
      "ASC_BOOTSTRAP_AUTH_ISSUER and ASC_BOOTSTRAP_AUTH_SUBJECT must be configured together."
    );
  }
  return Object.freeze({ issuer, subject });
}

async function ensurePersonalBootstrap(
  identities: PersistentIdentityRegistry
): Promise<void> {
  if (!personalBootstrapEnabled()) return;

  const domains = await identities.listAccountDomains();
  const existing = domains.find(
    (domain) => domain.accountDomainId === defaultAccountDomainId()
  );

  if (!existing) {
    await identities.bootstrapPersonal({
      principalId: bootstrapPrincipalId(),
      principalDisplayName: bootstrapPrincipalName(),
      accountDomainId: defaultAccountDomainId(),
      accountDomainName: defaultAccountDomainName()
    });
  }

  const externalIdentity = bootstrapAuthenticationIdentity();
  if (externalIdentity) {
    await identities.registerAuthenticationIdentity({
      principalId: bootstrapPrincipalId(),
      issuer: externalIdentity.issuer,
      subject: externalIdentity.subject,
      label: "Personal bootstrap identity"
    });
  }
}

export async function identityRegistryServices() {
  const identities = new PersistentIdentityRegistry(identityDirectoryStore());
  await ensurePersonalBootstrap(identities);
  return { identities };
}

export async function controlRegistryServicesForDomain(
  accountDomainId: string
) {
  const { identities } = await identityRegistryServices();
  await identities.assertActiveDomain(accountDomainId);
  const store = controlRegistryStoreForDomain(accountDomainId);

  return {
    store,
    identities,
    projects: new PersistentProjectRegistry(store, identities),
    connections: new PersistentConnectionRegistry(store, identities),
    bindings: new PersistentProjectConnectionBindingRegistry(store),
    authority: new WorkerAuthorityService(store, identities),
    continuation: new ContinuationAuthorityService(store, identities)
  };
}

export async function controlRegistryServices() {
  const services = await controlRegistryServicesForDomain(
    defaultAccountDomainId()
  );
  return {
    ...services,
    principalId: resolvedPersonalPrincipalId()
  };
}

export async function loadConnectionsControlView() {
  if (!controlRegistryConfigured()) {
    return {
      configured: false as const,
      accountDomainId: defaultAccountDomainId(),
      projects: [],
      connections: [],
      bindings: []
    };
  }

  const services = await controlRegistryServices();
  const [projects, connections, bindings] = await Promise.all([
    services.projects.listProjects(),
    services.connections.listConnections(),
    services.bindings.listBindings()
  ]);

  return {
    configured: true as const,
    accountDomainId: services.store.accountDomainId,
    projects,
    connections,
    bindings
  };
}

export async function loadProjectControlView(repository: string) {
  if (!controlRegistryConfigured()) {
    return {
      configured: false as const,
      registered: false as const,
      principalAvailable: false,
      accountDomainId: defaultAccountDomainId(),
      reason: "ASC control registry is not configured."
    };
  }

  const services = await controlRegistryServices();
  const project = await services.projects.getByGithubRepository(repository);
  if (!project) {
    return {
      configured: true as const,
      registered: false as const,
      principalAvailable: services.principalId !== null,
      accountDomainId: services.store.accountDomainId,
      reason: "This repository is not registered as a durable ASC Project."
    };
  }

  const control = await services.authority.getProjectControl(project.projectId);
  return {
    configured: true as const,
    registered: true as const,
    principalAvailable: services.principalId !== null,
    accountDomainId: services.store.accountDomainId,
    projectId: project.projectId,
    mode: control.mode,
    generation: control.generation,
    ...(control.changedAt ? { changedAt: control.changedAt } : {}),
    ...(control.reason ? { reason: control.reason } : {})
  };
}
