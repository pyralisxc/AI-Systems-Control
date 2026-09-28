import {
  deriveConnectionFirstSetup,
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
  resolveMcpOAuthJwks,
  mcpResourceMetadataUrl,
  mcpResourceUrl,
  mcpResourceUrlSource,
  mcpScopeClaim
} from "./mcp-resource";
import {
  threadStoreForDomain
} from "./thread-pulse";

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
  let oauthJwksConfigured = false;
  let oauthJwksSource:
    | "explicit"
    | "oauth_metadata"
    | "oidc_metadata"
    | undefined;

  if (oauthIssuerConfigured) {
    try {
      const resolution = await resolveMcpOAuthJwks();
      oauthJwksConfigured = true;
      oauthJwksSource = resolution.source;
    } catch {
      oauthJwksConfigured = false;
    }
  }

  let externalIdentityBound = false;
  let databaseReadable = false;
  let identityStateReadable = false;
  let identities:
    | Awaited<ReturnType<typeof identityRegistryServices>>["identities"]
    | undefined;
  let activePairing:
    | {
        readonly pairingId: string;
        readonly state: "armed" | "candidate_detected";
        readonly expiresAt: string;
      }
    | undefined;

  if (durableStorageConfigured) {
    try {
      identities = (await identityRegistryServices()).identities;
      databaseReadable = true;
      identityStateReadable = true;
    } catch {
      databaseReadable = false;
      identityStateReadable = false;
    }
  }

  if (
    databaseReadable &&
    identities &&
    oauthIssuerConfigured
  ) {
    try {
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
    } catch {
      identityStateReadable = false;
    }
  }

  let chatgptEvidence = false;
  let chatgptLastSeenAt: string | undefined;

  if (databaseReadable) {
    try {
      const principalId = bootstrapPrincipalId();
      const store = threadStoreForDomain(
        defaultAccountDomainId()
      );
      const snapshots = await store.list();
      const authenticatedChatgpt = snapshots
        .filter((snapshot) => {
          const provider =
            snapshot.thread.externalReference?.provider
              ?.trim()
              .toLowerCase();
          if (provider !== "chatgpt") return false;

          return (
            snapshot.checkpoints.some(
              (checkpoint) =>
                checkpoint.publishedByPrincipalId === principalId
            ) ||
            snapshot.activities.some(
              (activity) =>
                activity.publishedByPrincipalId === principalId &&
                activity.source === "mcp"
            )
          );
        })
        .sort((left, right) =>
          right.thread.updatedAt.localeCompare(
            left.thread.updatedAt
          )
        );

      const latest = authenticatedChatgpt[0];
      if (latest) {
        chatgptEvidence = true;
        chatgptLastSeenAt = latest.thread.updatedAt;
      }
    } catch {
      // Thread evidence is supplemental. Storage/identity health is
      // represented independently and remains fail-closed above.
    }
  }

  const readiness = deriveMcpSetupReadiness({
    durableStorageConfigured,
    resourceUrlConfigured: Boolean(urls),
    oauthIssuerConfigured,
    oauthJwksConfigured,
    externalIdentityBound
  });

  const connections = deriveConnectionFirstSetup({
    databaseConfigured: durableStorageConfigured,
    databaseReadable,
    resourceConfigured: Boolean(urls),
    issuerConfigured: oauthIssuerConfigured,
    signingKeysReady: oauthJwksConfigured,
    identityStateReadable,
    identityBound: externalIdentityBound,
    ...(activePairing
      ? { pairingState: activePairing.state }
      : {}),
    chatgptEvidence
  });

  return Object.freeze({
    readiness,
    configuration: Object.freeze({
      durableStorageConfigured,
      durableStorageReadable: databaseReadable,
      durableStorageSource: controlRegistryDatabaseUrlSource(),
      resourceUrlConfigured: Boolean(urls),
      resourceUrlSource: urls?.source,
      oauthIssuerConfigured,
      oauthJwksConfigured,
      oauthJwksSource,
      externalIdentityBound,
      identityStateReadable,
      pairingState: activePairing?.state,
      documentationConfigured: present(
        "ASC_MCP_DOCUMENTATION_URL"
      )
    }),
    pairing: activePairing,
    connections,
    chatgptEvidence: Object.freeze({
      connected: chatgptEvidence,
      ...(chatgptLastSeenAt
        ? { lastSeenAt: chatgptLastSeenAt }
        : {})
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
