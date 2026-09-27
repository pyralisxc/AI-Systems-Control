import type {
  GithubRepositoryReconciliation,
  ResolveGithubProjectInput
} from "./project-registry.js";
import {
  InMemoryProjectRegistry
} from "./project-registry.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";
import type { Project } from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export class PersistentProjectRegistry {
  readonly #store: ControlRegistryStore;

  constructor(store: ControlRegistryStore) {
    this.#store = store;
  }

  async listProjects(): Promise<readonly Project[]> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectRegistry(snapshot.projects).listProjects();
  }

  async get(projectId: string): Promise<Project | undefined> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectRegistry(snapshot.projects).get(projectId);
  }

  async getByAlias(alias: string): Promise<Project | undefined> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectRegistry(snapshot.projects).getByAlias(alias);
  }

  async getByGithubRepository(repository: string): Promise<Project | undefined> {
    const snapshot = await this.#store.load();
    return new InMemoryProjectRegistry(snapshot.projects).getByGithubRepository(repository);
  }

  async resolveOrRegisterGithubProject(input: ResolveGithubProjectInput): Promise<Project> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryProjectRegistry(snapshot.projects);
      const before = stableJson(registry.listProjects());
      const result = registry.resolveOrRegisterGithubProject(input);
      const projects = registry.listProjects();
      return {
        result,
        projects,
        connections: snapshot.connections,
        changed: before !== stableJson(projects)
      };
    });
  }

  async registerAlias(projectId: string, alias: string): Promise<Project> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryProjectRegistry(snapshot.projects);
      const before = stableJson(registry.listProjects());
      const result = registry.registerAlias(projectId, alias);
      const projects = registry.listProjects();
      return {
        result,
        projects,
        connections: snapshot.connections,
        changed: before !== stableJson(projects)
      };
    });
  }

  async reconcileGithubRepository(
    projectId: string,
    nextRepository: string
  ): Promise<GithubRepositoryReconciliation> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryProjectRegistry(snapshot.projects);
      const before = stableJson(registry.listProjects());
      const result = registry.reconcileGithubRepository(projectId, nextRepository);
      const projects = registry.listProjects();
      return {
        result,
        projects,
        connections: snapshot.connections,
        changed: before !== stableJson(projects)
      };
    });
  }

  async markUnavailable(projectId: string): Promise<Project> {
    return mutateControlRegistry(this.#store, (snapshot) => {
      const registry = new InMemoryProjectRegistry(snapshot.projects);
      const before = stableJson(registry.listProjects());
      const result = registry.markUnavailable(projectId);
      const projects = registry.listProjects();
      return {
        result,
        projects,
        connections: snapshot.connections,
        changed: before !== stableJson(projects)
      };
    });
  }
}
