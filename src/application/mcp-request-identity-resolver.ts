import {
  McpAuthenticationError,
  type AuthenticatedMcpCaller,
  type McpAccessTokenVerifier
} from "../ports/index.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";

export class McpRequestIdentityResolver {
  readonly #verifier: McpAccessTokenVerifier;
  readonly #identities: PersistentIdentityRegistry;

  constructor(input: {
    readonly verifier: McpAccessTokenVerifier;
    readonly identities: PersistentIdentityRegistry;
  }) {
    this.#verifier = input.verifier;
    this.#identities = input.identities;
  }

  async resolve(
    token: string,
    requiredScopes: readonly string[] = []
  ): Promise<AuthenticatedMcpCaller> {
    const verified = await this.#verifier.verify(token);
    const binding = await this.#identities.resolveAuthenticationIdentity(
      verified.issuer,
      verified.subject
    );
    if (!binding) {
      throw new McpAuthenticationError(
        "Authenticated external identity is not linked to an ASC Principal."
      );
    }

    const principal = await this.#identities.getPrincipal(binding.principalId);
    if (!principal || principal.status !== "active") {
      throw new McpAuthenticationError(
        "Resolved ASC Principal is unavailable or inactive."
      );
    }

    let membership;
    try {
      membership = await this.#identities.assertActiveMembership(
        binding.principalId,
        verified.accountDomainId
      );
    } catch {
      throw new McpAuthenticationError(
        "Resolved Principal has no active Membership in the requested AccountDomain."
      );
    }

    const missing = requiredScopes.filter(
      (scope) => !verified.scopes.includes(scope)
    );
    if (missing.length > 0) {
      throw new McpAuthenticationError(
        "Access token is missing required scope(s): " + missing.join(", ")
      );
    }

    return Object.freeze({
      principalId: binding.principalId,
      membershipId: membership.membershipId,
      accountDomainId: verified.accountDomainId,
      issuer: verified.issuer,
      subject: verified.subject,
      scopes: Object.freeze([...verified.scopes]),
      expiresAt: verified.expiresAt
    });
  }
}
