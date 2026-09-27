import type {
  AccountDomainId,
  Connection,
  ContinuationControlState,
  DelegationRecord,
  Project,
  ProjectConnectionBinding,
  WorkerControlState
} from "../domain/index.js";
import {
  emptyContinuationControlState,
  emptyWorkerControlState
} from "../domain/index.js";

export const CONTROL_REGISTRY_SCHEMA_VERSION = 5 as const;

export interface ControlRegistrySnapshot {
  readonly schemaVersion: typeof CONTROL_REGISTRY_SCHEMA_VERSION;
  readonly accountDomainId: AccountDomainId;
  readonly revision: number;
  readonly projects: readonly Project[];
  readonly connections: readonly Connection[];
  readonly projectConnectionBindings: readonly ProjectConnectionBinding[];
  readonly delegations: readonly DelegationRecord[];
  readonly workerControl: WorkerControlState;
  readonly continuationControl: ContinuationControlState;
  readonly updatedAt?: string;
}

export interface SaveControlRegistryInput {
  readonly expectedRevision: number;
  readonly projects: readonly Project[];
  readonly connections: readonly Connection[];
  readonly projectConnectionBindings: readonly ProjectConnectionBinding[];
  readonly delegations: readonly DelegationRecord[];
  readonly workerControl: WorkerControlState;
  readonly continuationControl: ContinuationControlState;
  readonly updatedAt?: string;
}

export interface ControlRegistryStore {
  readonly accountDomainId: AccountDomainId;
  load(): Promise<ControlRegistrySnapshot>;
  save(input: SaveControlRegistryInput): Promise<ControlRegistrySnapshot>;
}

export class RegistryRevisionConflictError extends Error {
  readonly code = "registry_revision_conflict";

  constructor(expected: number, actual: number) {
    super("Registry revision conflict: expected " + expected + ", current " + actual + ".");
    this.name = "RegistryRevisionConflictError";
  }
}

export function emptyControlRegistrySnapshot(
  accountDomainId: AccountDomainId
): ControlRegistrySnapshot {
  return Object.freeze({
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    accountDomainId,
    revision: 0,
    projects: Object.freeze([]),
    connections: Object.freeze([]),
    projectConnectionBindings: Object.freeze([]),
    delegations: Object.freeze([]),
    workerControl: emptyWorkerControlState(),
    continuationControl: emptyContinuationControlState()
  });
}
