import type { EffectClass } from "./capability.js";
import type {
  ConnectionId,
  IsoTimestamp,
  ProjectId,
  WorkspaceId
} from "./shared.js";

export const PROJECT_CONNECTION_BINDING_STATUSES = ["active", "revoked"] as const;
export type ProjectConnectionBindingStatus =
  (typeof PROJECT_CONNECTION_BINDING_STATUSES)[number];

export interface CapabilityScope {
  readonly kind: "exact" | "prefix";
  readonly value: string;
}

export interface ProviderResourceReference {
  readonly kind: string;
  readonly value: string;
}

export interface ProjectConnectionBinding {
  readonly bindingId: string;
  readonly projectId: ProjectId;
  readonly connectionId: ConnectionId;
  readonly workspaceId?: WorkspaceId;
  readonly environment?: string;
  readonly capabilityScope: CapabilityScope;
  readonly resource?: ProviderResourceReference;
  readonly selection: "default" | "explicit";
  readonly approvalRequiredFor: readonly EffectClass[];
  readonly status: ProjectConnectionBindingStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}
