import {
  deriveMcpSetupReadiness
} from "../../../dist/application/index.js";
import {
  bootstrapPrincipalId,
  bootstrapPrincipalName,
  controlRegistryConfigured,
  controlRegistryDatabaseUrlSource,
  defaultAccountDomainId,
  defaultAccountDomainName,
  identityRegistryServices,
  personalBootstrapEnabled
} from "./control-registry";
import {
  ASC_MCP_SCOPES,
  mcpAccountDomainClaim,
  mcpOAuthIssuer,
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

export async function loadMcpSetupReadinessView() {
  const urls = safeResourceUrls();
  const durableStorageConfigured = controlRegistryConfigured();
  const oauthIssuerConfigured = present("ASC_OAUTH_ISSUER");
  const oauthJwksConfigured = present("ASC_OAUTH_JWKS_URL");

  let externalIdentityBound = false;
  let identityStateReadable = !durableStorageConfigured;
  let activePairing:
    | {
        readonly pairingId: string;
        readonly state: "armed" | "candidate_detected";
        readonly expiresAt: string;
      }
    | undefined;

  if (durableStorageConfigured && oauthIssuerConfigured) {
    try {
      const { identities } = await identityRegistryServices();
      const issuer = mcpOAuthIssuer();
      const principalId = bootstrapPrincipalId();
      const accountDomainId = defaultAccountDomainId();

      const bindings = await identities.listAuthenticationBindings();
      externalIdentityBound = bindings.some(
        (binding) =>
          binding.status === "active" &&
          binding.principalId === principalId &&
          binding.issuer === issuer
      );

      if (!externalIdentityBound) {
        const now = Date.now();
        const pairings =
          await identities.listAuthenticationPairings(accountDomainId);
        const pairing = pairings.find(
          (candidate) =>
            candidate.principalId === principalId &&
            candidate.issuer === issuer &&
            (candidate.state === "armed" ||
              candidate.state === "candidate_detected") &&
            Date.parse(candidate.expiresAt) > now
        );

        if (
          pairing &&
          (
            pairing.state === "armed" ||
            pairing.state === "candidate_detected"
          )
        ) {
          activePairing = Object.freeze({
            pairingId: pairing.pairingId,
            state: pairing.state,
            expiresAt: pairing.expiresAt
          });
        }
      }

      identityStateReadable = true;
    } catch {
      identityStateReadable = false;
    }
  }

  const readiness = deriveMcpSetupReadiness({
    durableStorageConfigured,
    resourceUrlConfigured: Boolean(urls),
    oauthIssuerConfigured,
    oauthJwksConfigured,
    externalIdentityBound
  });

  return Object.freeze({
    readiness,
    configuration: Object.freeze({
      durableStorageConfigured,
      durableStorageSource: controlRegistryDatabaseUrlSource(),
      resourceUrlConfigured: Boolean(urls),
      resourceUrlSource: urls?.source,
      oauthIssuerConfigured,
      oauthJwksConfigured,
      externalIdentityBound,
      identityStateReadable,
      pairingState: activePairing?.state,
      documentationConfigured: present(
        "ASC_MCP_DOCUMENTATION_URL"
      )
    }),
    pairing: activePairing,
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
