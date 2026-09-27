import type {
  AuthenticationStrategy,
  ConnectionStatus
} from "../domain/index.js";

export interface BeginConnectionAuthorizationInput {
  readonly flowId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly state: string;
  readonly callbackUrl: string;
}

export interface BeginConnectionAuthorizationResult {
  readonly authorizationUrl: string;
  readonly providerFlowReference?: string;
}

export interface CompleteConnectionAuthorizationInput {
  readonly flowId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly callback: Readonly<Record<string, string>>;
  readonly providerFlowReference?: string;
}

export interface AuthorizedConnectionMetadata {
  readonly providerAccountId: string;
  readonly providerDisplayName?: string;
  readonly label?: string;
  readonly environment?: string;
  readonly authenticationStrategy: AuthenticationStrategy;
  readonly capabilities: readonly string[];
}

export interface VerifyConnectionAuthorizationInput {
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly providerAccountId: string;
  readonly environment?: string;
}

export interface VerifyConnectionAuthorizationResult {
  readonly status: Extract<
    ConnectionStatus,
    "active" | "reconnect_required" | "unavailable"
  >;
  readonly capabilities: readonly string[];
  readonly verifiedAt: string;
}

export interface RevokeConnectionAuthorizationInput {
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly providerAccountId: string;
  readonly environment?: string;
}

export interface ConnectionAuthorizationProvider {
  readonly provider: string;

  beginAuthorization(
    input: BeginConnectionAuthorizationInput
  ): Promise<BeginConnectionAuthorizationResult>;

  completeAuthorization(
    input: CompleteConnectionAuthorizationInput
  ): Promise<AuthorizedConnectionMetadata>;

  verifyAuthorization(
    input: VerifyConnectionAuthorizationInput
  ): Promise<VerifyConnectionAuthorizationResult>;

  revokeAuthorization(
    input: RevokeConnectionAuthorizationInput
  ): Promise<void>;
}
