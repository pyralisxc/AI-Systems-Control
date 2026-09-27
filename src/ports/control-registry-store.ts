import type {
  Connection,
  DelegationRecord,
  Project,
  ProjectConnectionBinding
} from "../domain/index.js";

export const CONTROL_REGISTRY_SCHEMA_VERSION = 2 as const;

export interface ControlRegistrySnapshot {
  readonly schemaVersion: typeof CONTROL_REGISTRY_SCHEMA_VERSION;
  readonly revision: number;
  readonly projects: readonly Project[];
  readonly connections: readonly Connection[];
  readonly projectConnectionBindings: readonly ProjectConnectionBinding[];
  readonly delegations: readonly DelegationRecord[];
  readonly updatedAt?: string;
}

export interface SaveControlRegistryInput {
  readonly expectedRevision: number;
  readonly projects: readonly Project[];
  readonly connections: readonly Connection[];
  readonly projectConnectionBindings: readonly ProjectConnectionBinding[];
  readonly delegations: readonly DelegationRecord[];
  readonly updatedAt?: string;
}

export interface ControlRegistryStore {
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

export function emptyControlRegistrySnapshot(): ControlRegistrySnapshot {
  return Object.freeze({
    schemaVersion: CONTROL_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    projects: Object.freeze([]),
    connections: Object.freeze([]),
    projectConnectionBindings: Object.freeze([]),
    delegations: Object.freeze([])
  });
}
