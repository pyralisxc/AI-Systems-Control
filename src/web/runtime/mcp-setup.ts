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
  mcpResourceUrl,
  mcpResourceUrlSource,
  mcpScopeClaim
} from "./mcp-resource";

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function safeResourceUrls():
  | {
      readonly resourceUrl: string;
      readonly metadataUrl: string;
      readonly source: "explicit" | "vercel_branch";
    }
  | undefined {
  try {
    const source = mcpResourceUrlSource();
    if (!source) return undefined;

    return Object.freeze({
      resourceUrl: mcpResourceUrl(),
      metadataUrl: mcpResourceMetadataUrl(),
      source
    });
  } catch {
    return undefined;
  }
}

export function loadMcpSetupReadinessView() {
  const urls = safeResourceUrls();
  const readiness = deriveMcpSetupReadiness({
    durableStorageConfigured: controlRegistryConfigured(),
    resourceUrlConfigured: Boolean(urls),
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
      resourceUrlConfigured: Boolean(urls),
      resourceUrlSource: urls?.source,
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
