import type {
  ExternalRepositoryAttestor
} from "./external-repository-attestor.js";

export interface ExternalConnectionMetadata {
  readonly connectionReference: string;
  readonly accountReference: string;
  readonly accountDisplayName: string;
  readonly accountType: string;
  readonly connectedAt: string;
  readonly observedAt: string;
}

export interface ExternalConnectionAttestor
  extends ExternalRepositoryAttestor {
  listConnections():
    Promise<readonly ExternalConnectionMetadata[]>;
}
