export interface VerifiedMcpAccessToken {
  readonly issuer: string;
  readonly subject: string;
  readonly accountDomainId: string;
  readonly audience: readonly string[];
  readonly scopes: readonly string[];
  readonly expiresAt: number;
}

export interface McpAccessTokenVerifier {
  verify(token: string): Promise<VerifiedMcpAccessToken>;
}

export interface AuthenticatedMcpCaller {
  readonly principalId: string;
  readonly membershipId: string;
  readonly accountDomainId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly expiresAt: number;
}

export class McpAuthenticationError extends Error {
  readonly code = "mcp_authentication_failed";

  constructor(message: string) {
    super(message);
    this.name = "McpAuthenticationError";
  }
}
