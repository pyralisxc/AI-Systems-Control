import type {
  AccountDomainId,
  ConnectionId,
  IsoTimestamp,
  OwnerId
} from "./shared.js";

export const CONNECTION_STATUSES = [
  "active",
  "reconnect_required",
  "unavailable",
  "revoked"
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const AUTHENTICATION_STRATEGIES = [
  "oauth",
  "app_installation",
  "api_credential",
  "delegated_service"
] as const;
export type AuthenticationStrategy = (typeof AUTHENTICATION_STRATEGIES)[number];

export interface Connection {
  readonly connectionId: ConnectionId;
  readonly ownerId: OwnerId;
  readonly accountDomainId: AccountDomainId;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly providerDisplayName?: string;
  readonly label?: string;
  readonly environment?: string;
  readonly authenticationStrategy: AuthenticationStrategy;
  readonly status: ConnectionStatus;
  readonly capabilities: readonly string[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly lastVerifiedAt?: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}
