import type {
  AccountDomain,
  AuthenticationIdentityBinding,
  AuthenticationIdentityPairing,
  Membership,
  Principal
} from "../domain/index.js";

export const IDENTITY_DIRECTORY_SCHEMA_VERSION = 4 as const;

export interface IdentityDirectorySnapshot {
  readonly schemaVersion: typeof IDENTITY_DIRECTORY_SCHEMA_VERSION;
  readonly revision: number;
  readonly principals: readonly Principal[];
  readonly accountDomains: readonly AccountDomain[];
  readonly memberships: readonly Membership[];
  readonly authenticationBindings: readonly AuthenticationIdentityBinding[];
  readonly authenticationPairings: readonly AuthenticationIdentityPairing[];
  readonly updatedAt?: string;
}

export interface SaveIdentityDirectoryInput {
  readonly expectedRevision: number;
  readonly principals: readonly Principal[];
  readonly accountDomains: readonly AccountDomain[];
  readonly memberships: readonly Membership[];
  readonly authenticationBindings: readonly AuthenticationIdentityBinding[];
  readonly authenticationPairings: readonly AuthenticationIdentityPairing[];
  readonly updatedAt?: string;
}

export interface IdentityDirectoryStore {
  load(): Promise<IdentityDirectorySnapshot>;
  save(input: SaveIdentityDirectoryInput): Promise<IdentityDirectorySnapshot>;
}

export class IdentityDirectoryRevisionConflictError extends Error {
  readonly code = "identity_directory_revision_conflict";

  constructor(expected: number, actual: number) {
    super(
      "Identity directory revision conflict: expected " +
      expected + ", current " + actual + "."
    );
    this.name = "IdentityDirectoryRevisionConflictError";
  }
}

export function emptyIdentityDirectorySnapshot(): IdentityDirectorySnapshot {
  return Object.freeze({
    schemaVersion: IDENTITY_DIRECTORY_SCHEMA_VERSION,
    revision: 0,
    principals: Object.freeze([]),
    accountDomains: Object.freeze([]),
    memberships: Object.freeze([]),
    authenticationBindings: Object.freeze([]),
    authenticationPairings: Object.freeze([])
  });
}
