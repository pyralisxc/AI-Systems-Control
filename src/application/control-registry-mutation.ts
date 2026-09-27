import type {
  Connection,
  Project
} from "../domain/index.js";
import {
  RegistryRevisionConflictError,
  type ControlRegistrySnapshot,
  type ControlRegistryStore
} from "../ports/index.js";

export interface RegistryMutationResult<T> {
  readonly result: T;
  readonly projects: readonly Project[];
  readonly connections: readonly Connection[];
  readonly changed: boolean;
}

export async function mutateControlRegistry<T>(
  store: ControlRegistryStore,
  mutate: (snapshot: ControlRegistrySnapshot) => RegistryMutationResult<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await store.load();
    const mutation = mutate(snapshot);

    if (!mutation.changed) return mutation.result;

    try {
      await store.save({
        expectedRevision: snapshot.revision,
        projects: mutation.projects,
        connections: mutation.connections,
        updatedAt: new Date().toISOString()
      });
      return mutation.result;
    } catch (error) {
      if (!(error instanceof RegistryRevisionConflictError) || attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  throw new Error("Control registry mutation exhausted retry budget.");
}
