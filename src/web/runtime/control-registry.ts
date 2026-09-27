import {
  JsonFileControlRegistryStore,
  JsonFileIdentityDirectoryStore,
  PostgresControlRegistryStore,
  PostgresIdentityDirectoryStore
} from "../../../dist/adapters/index.js";
import {
  PersistentConnectionRegistry,
  PersistentIdentityRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry
} from "../../../dist/application/index.js";
import type {
  ControlRegistryStore,
  IdentityDirectoryStore
} from "../../../dist/ports/index.js";

let cachedDatabaseUrl: string | undefined;
let cachedAccountDomainId: string | undefined;
let cachedDatabaseStore: PostgresControlRegistryStore | undefined;
let cachedIdentityDatabaseUrl: string | undefined;
let cachedIdentityStore: PostgresIdentityDirectoryStore | undefined;

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

export function controlRegistryConfigured(): boolean {
  return Boolean(controlRegistryDatabaseUrl() || controlRegistryPath());
}

export function personalBootstrapEnabled(): boolean {
  return process.env.ASC_PERSONAL_BOOTSTRAP_ENABLED?.trim().toLowerCase() !== "false";
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

function controlRegistryStore(): ControlRegistryStore {
  const accountDomainId = defaultAccountDomainId();
  const databaseUrl = controlRegistryDatabaseUrl();
  if (databaseUrl) {
    if (
      !cachedDatabaseStore ||
      cachedDatabaseUrl !== databaseUrl ||
      cachedAccountDomainId !== accountDomainId
    ) {
      cachedDatabaseStore = PostgresControlRegistryStore.fromConnectionString(
        databaseUrl,
        accountDomainId
      );
      cachedDatabaseUrl = databaseUrl;
      cachedAccountDomainId = accountDomainId;
    }
    return cachedDatabaseStore;
  }

  const path = controlRegistryPath();
  if (path) {
    return new JsonFileControlRegistryStore(path, accountDomainId);
  }

  throw new Error(
    "ASC control registry storage is not configured. Set ASC_CONTROL_REGISTRY_DATABASE_URL " +
    "for PostgreSQL or ASC_CONTROL_REGISTRY_PATH for a persistent local volume."
  );
}

async function ensurePersonalBootstrap(
  identities: PersistentIdentityRegistry
): Promise<void> {
  if (!personalBootstrapEnabled()) return;

  const domains = await identities.listAccountDomains();
  const existing = domains.find(
    (domain) => domain.accountDomainId === defaultAccountDomainId()
  );
  if (existing) return;

  await identities.bootstrapPersonal({
    principalId: bootstrapPrincipalId(),
    principalDisplayName: bootstrapPrincipalName(),
    accountDomainId: defaultAccountDomainId(),
    accountDomainName: defaultAccountDomainName()
  });
}

export async function controlRegistryServices() {
  const store = controlRegistryStore();
  const identities = new PersistentIdentityRegistry(identityDirectoryStore());
  await ensurePersonalBootstrap(identities);

  return {
    store,
    identities,
    principalId: bootstrapPrincipalId(),
    projects: new PersistentProjectRegistry(store, identities),
    connections: new PersistentConnectionRegistry(store, identities),
    bindings: new PersistentProjectConnectionBindingRegistry(store)
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
