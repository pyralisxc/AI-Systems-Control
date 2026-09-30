import type { EffectClass } from "./capability.js";
import type { ProviderResourceReference } from "./project-connection-binding.js";
import type {
  AccountDomainId,
  ConnectionId,
  IsoTimestamp,
  MembershipId,
  PrincipalId,
  ProjectId,
  ProjectMembershipId,
  WorkspaceId
} from "./shared.js";

export const DELEGATION_STATES = ["active", "consumed", "revoked"] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];

export interface DelegationRecord {
  readonly delegationId: string;
  readonly handleHash: string;
  readonly bindingId: string;
  readonly connectionId: ConnectionId;
  readonly connectionGeneration: number;
  readonly principalId?: PrincipalId;
  readonly membershipId?: MembershipId;
  readonly membershipGeneration?: number;
  readonly projectMembershipId?: ProjectMembershipId;
  readonly projectMembershipGeneration?: number;
  readonly projectId: ProjectId;
  readonly workspaceId?: WorkspaceId;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly environment?: string;
  readonly resource?: ProviderResourceReference;
  readonly audience: string;
  readonly approvalReference?: string;
  readonly issuedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly state: DelegationState;
  readonly consumedAt?: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}

export interface DelegationUseReceipt {
  readonly accountDomainId: AccountDomainId;
  readonly delegationId: string;
  readonly bindingId: string;
  readonly connectionId: ConnectionId;
  readonly connectionGeneration: number;
  readonly principalId: PrincipalId;
  readonly membershipId: MembershipId;
  readonly membershipGeneration: number;
  readonly projectMembershipId: ProjectMembershipId;
  readonly projectMembershipGeneration: number;
  readonly projectId: ProjectId;
  readonly workspaceId?: WorkspaceId;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly environment?: string;
  readonly resource?: ProviderResourceReference;
  readonly audience: string;
  readonly approvalReference?: string;
  readonly consumedAt: IsoTimestamp;
}
