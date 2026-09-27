import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier
} from "@modelcontextprotocol/server";

import { McpAuthenticationError } from "../../ports/mcp-auth.js";
import { McpRequestIdentityResolver } from "../../application/mcp-request-identity-resolver.js";

export class SdkMcpOAuthTokenVerifier implements OAuthTokenVerifier {
  readonly #resolver: McpRequestIdentityResolver;

  constructor(resolver: McpRequestIdentityResolver) {
    this.#resolver = resolver;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const caller = await this.#resolver.resolve(token);
      return {
        token,
        clientId: caller.principalId,
        scopes: [...caller.scopes],
        expiresAt: caller.expiresAt
      };
    } catch (error) {
      if (error instanceof McpAuthenticationError) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Access token is invalid for this ASC resource."
        );
      }
      throw error;
    }
  }
}
