import type {
  Connection,
  ContinuationControlState,
  DelegationRecord,
  Project,
  ProjectConnectionBinding,
  ProjectMembership,
  WorkerControlState
} from "../domain/index.js";
import {
  RegistryRevisionConflictError,
  type ControlRegistrySnapshot,
  type ControlRegistryStore
} from "../ports/index.js";

export interface RegistryMutationResult<T> {
  readonly result: T;
  readonly projects: readonly Project[];
  readonly projectMemberships?: readonly ProjectMembership[];
  readonly connections: readonly Connection[];
  readonly projectConnectionBindings: readonly ProjectConnectionBinding[];
  readonly delegations: readonly DelegationRecord[];
  readonly workerControl?: WorkerControlState;
  readonly continuationControl?: ContinuationControlState;
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
        projectMemberships:
          mutation.projectMemberships ??
          snapshot.projectMemberships,
        connections: mutation.connections,
        projectConnectionBindings: mutation.projectConnectionBindings,
        delegations: mutation.delegations,
        workerControl: mutation.workerControl ?? snapshot.workerControl,
        continuationControl:
          mutation.continuationControl ?? snapshot.continuationControl,
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
