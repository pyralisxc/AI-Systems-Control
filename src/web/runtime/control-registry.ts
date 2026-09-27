import {
  JsonFileControlRegistryStore,
  PostgresControlRegistryStore
} from "../../../dist/adapters/index.js";
import {
  PersistentConnectionRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry
} from "../../../dist/application/index.js";
import type { ControlRegistryStore } from "../../../dist/ports/index.js";

let cachedDatabaseUrl: string | undefined;
let cachedAccountDomainId: string | undefined;
let cachedDatabaseStore: PostgresControlRegistryStore | undefined;

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

export function controlRegistryConfigured(): boolean {
  return Boolean(controlRegistryDatabaseUrl() || controlRegistryPath());
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

export function controlRegistryServices() {
  const store = controlRegistryStore();
  return {
    store,
    projects: new PersistentProjectRegistry(store),
    connections: new PersistentConnectionRegistry(store),
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

  const services = controlRegistryServices();
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
