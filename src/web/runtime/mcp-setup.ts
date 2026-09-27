import {
  deriveMcpSetupReadiness
} from "../../../dist/application/index.js";
import {
  bootstrapPrincipalId,
  bootstrapPrincipalName,
  controlRegistryConfigured,
  defaultAccountDomainId,
  defaultAccountDomainName,
  personalBootstrapEnabled
} from "./control-registry";
import {
  ASC_MCP_SCOPES,
  mcpAccountDomainClaim,
  mcpResourceMetadataUrl,
  mcpScopeClaim
} from "./mcp-resource";

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function safeResourceUrls():
  | {
      readonly resourceUrl: string;
      readonly metadataUrl: string;
    }
  | undefined {
  if (!present("ASC_MCP_RESOURCE_URL")) return undefined;

  const resourceUrl = process.env.ASC_MCP_RESOURCE_URL!.trim();
  try {
    return Object.freeze({
      resourceUrl,
      metadataUrl: mcpResourceMetadataUrl()
    });
  } catch {
    return undefined;
  }
}

export function loadMcpSetupReadinessView() {
  const urls = safeResourceUrls();
  const readiness = deriveMcpSetupReadiness({
    durableStorageConfigured: controlRegistryConfigured(),
    resourceUrlConfigured: present("ASC_MCP_RESOURCE_URL"),
    oauthIssuerConfigured: present("ASC_OAUTH_ISSUER"),
    oauthJwksConfigured: present("ASC_OAUTH_JWKS_URL"),
    externalIdentityIssuerConfigured: present(
      "ASC_BOOTSTRAP_AUTH_ISSUER"
    ),
    externalIdentitySubjectConfigured: present(
      "ASC_BOOTSTRAP_AUTH_SUBJECT"
    )
  });

  return Object.freeze({
    readiness,
    configuration: Object.freeze({
      durableStorageConfigured: controlRegistryConfigured(),
      resourceUrlConfigured: present("ASC_MCP_RESOURCE_URL"),
      oauthIssuerConfigured: present("ASC_OAUTH_ISSUER"),
      oauthJwksConfigured: present("ASC_OAUTH_JWKS_URL"),
      externalIdentityIssuerConfigured: present(
        "ASC_BOOTSTRAP_AUTH_ISSUER"
      ),
      externalIdentitySubjectConfigured: present(
        "ASC_BOOTSTRAP_AUTH_SUBJECT"
      ),
      documentationConfigured: present(
        "ASC_MCP_DOCUMENTATION_URL"
      )
    }),
    defaults: Object.freeze({
      accountDomainId: defaultAccountDomainId(),
      accountDomainName: defaultAccountDomainName(),
      personalBootstrapEnabled: personalBootstrapEnabled(),
      principalId: bootstrapPrincipalId(),
      principalName: bootstrapPrincipalName(),
      accountDomainClaim: mcpAccountDomainClaim(),
      scopeClaim: mcpScopeClaim(),
      scopes: ASC_MCP_SCOPES
    }),
    ...(urls ? { urls } : {})
  });
}
