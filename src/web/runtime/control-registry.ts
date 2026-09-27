import { JsonFileControlRegistryStore } from "../../../dist/adapters/index.js";
import {
  PersistentConnectionRegistry,
  PersistentProjectConnectionBindingRegistry,
  PersistentProjectRegistry
} from "../../../dist/application/index.js";

export function controlRegistryPath(): string | null {
  const value = process.env.ASC_CONTROL_REGISTRY_PATH?.trim();
  return value || null;
}

export function controlRegistryConfigured(): boolean {
  return Boolean(controlRegistryPath());
}

export function controlRegistryServices() {
  const path = controlRegistryPath();
  if (!path) {
    throw new Error(
      "ASC control registry storage is not configured. Set ASC_CONTROL_REGISTRY_PATH to a persistent server volume or install a hosted ControlRegistryStore adapter."
    );
  }

  const store = new JsonFileControlRegistryStore(path);
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
    projects,
    connections,
    bindings
  };
}
