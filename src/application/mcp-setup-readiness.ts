export const MCP_SETUP_READINESS_STATES = [
  "needs_storage",
  "needs_resource_url",
  "needs_idp",
  "needs_identity_binding",
  "ready_for_mcp_test"
] as const;

export type McpSetupReadinessState =
  (typeof MCP_SETUP_READINESS_STATES)[number];

export interface McpSetupInputs {
  readonly durableStorageConfigured: boolean;
  readonly resourceUrlConfigured: boolean;
  readonly oauthIssuerConfigured: boolean;
  readonly oauthJwksConfigured: boolean;
  readonly externalIdentityIssuerConfigured: boolean;
  readonly externalIdentitySubjectConfigured: boolean;
}

export interface McpSetupReadiness {
  readonly state: McpSetupReadinessState;
  readonly summary: string;
  readonly blockers: readonly string[];
}

export function deriveMcpSetupReadiness(
  input: McpSetupInputs
): McpSetupReadiness {
  if (!input.durableStorageConfigured) {
    return Object.freeze({
      state: "needs_storage",
      summary:
        "Durable ASC control/identity storage is required before authenticated MCP can resolve Principals and AccountDomains.",
      blockers: Object.freeze(["durable_storage"])
    });
  }

  if (!input.resourceUrlConfigured) {
    return Object.freeze({
      state: "needs_resource_url",
      summary:
        "A stable canonical Preview MCP resource URL is required before OAuth audience/resource binding can be configured.",
      blockers: Object.freeze(["stable_resource_url"])
    });
  }

  const idpBlockers: string[] = [];
  if (!input.oauthIssuerConfigured) idpBlockers.push("oauth_issuer");
  if (!input.oauthJwksConfigured) idpBlockers.push("oauth_jwks");

  if (idpBlockers.length > 0) {
    return Object.freeze({
      state: "needs_idp",
      summary:
        "Configure an external OAuth/OIDC authorization server and its signing-key endpoint.",
      blockers: Object.freeze(idpBlockers)
    });
  }

  if (
    !input.externalIdentityIssuerConfigured ||
    !input.externalIdentitySubjectConfigured
  ) {
    return Object.freeze({
      state: "needs_identity_binding",
      summary:
        "Bind the authenticated external issuer + subject to the existing ASC bootstrap Principal.",
      blockers: Object.freeze(["external_identity_binding"])
    });
  }

  return Object.freeze({
    state: "ready_for_mcp_test",
    summary:
      "ASC has the storage, resource, IdP, and identity-binding inputs required for MCP Inspector and ChatGPT connection testing.",
    blockers: Object.freeze([])
  });
}
