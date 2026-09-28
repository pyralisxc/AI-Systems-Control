import type {
  AuthorizedConnectionMetadata,
  BeginConnectionAuthorizationInput,
  BeginConnectionAuthorizationResult,
  CompleteConnectionAuthorizationInput,
  ConnectionAuthorizationProvider,
  RevokeConnectionAuthorizationInput,
  VerifyConnectionAuthorizationInput,
  VerifyConnectionAuthorizationResult
} from "../../ports/index.js";

export interface GitHubInstallationAttestation {
  readonly installationId: string;
  readonly accountId: string;
  readonly accountLogin: string;
  readonly accountType: "User" | "Organization" | "Enterprise";
  readonly repositorySelection: "all" | "selected";
  readonly capabilities: readonly string[];
  readonly verifiedAt: string;
}

export interface AttestGitHubInstallationInput {
  readonly installationId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface VerifyGitHubInstallationInput {
  readonly installationId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface GitHubAppIdentity {
  readonly appId: string;
  readonly appSlug: string;
}

export interface GitHubInstallationAttestor {
  getAppIdentity(): Promise<GitHubAppIdentity>;

  attestInstallation(
    input: AttestGitHubInstallationInput
  ): Promise<GitHubInstallationAttestation>;

  verifyInstallation(
    input: VerifyGitHubInstallationInput
  ): Promise<GitHubInstallationAttestation | undefined>;
}


export interface GitHubInstallationAuthorizationProviderOptions {
  readonly appSlug: string;
  readonly setupCallbackUrl: string;
  readonly attestor: GitHubInstallationAttestor;
}

export class GitHubInstallationAuthorizationError extends Error {
  readonly code = "github_installation_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name = "GitHubInstallationAuthorizationError";
  }
}

function appSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(normalized)
  ) {
    throw new GitHubInstallationAuthorizationError(
      "GitHub App slug is invalid."
    );
  }
  return normalized;
}

function secureUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GitHubInstallationAuthorizationError(
      label + " must be an absolute URL."
    );
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (
    url.protocol !== "https:" &&
    !(loopback && url.protocol === "http:")
  ) {
    throw new GitHubInstallationAuthorizationError(
      label + " must use HTTPS outside localhost."
    );
  }

  if (url.hash) {
    throw new GitHubInstallationAuthorizationError(
      label + " must not contain a fragment."
    );
  }

  return url.toString();
}

function installationId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]{0,19}$/u.test(normalized)) {
    throw new GitHubInstallationAuthorizationError(
      "GitHub callback installation_id is invalid."
    );
  }
  return normalized;
}

function connectionProviderAccountId(
  installationIdValue: string
): string {
  return "installation:" + installationIdValue;
}

function parseProviderAccountId(value: string): string {
  const prefix = "installation:";
  if (!value.startsWith(prefix)) {
    throw new GitHubInstallationAuthorizationError(
      "GitHub Connection identity is not an installation."
    );
  }
  return installationId(value.slice(prefix.length));
}

function capabilities(
  values: readonly string[]
): readonly string[] {
  return Object.freeze([
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].sort());
}

export class GitHubInstallationAuthorizationProvider
  implements ConnectionAuthorizationProvider
{
  readonly provider = "github";
  readonly #appSlug: string;
  readonly #setupCallbackUrl: string;
  readonly #attestor: GitHubInstallationAttestor;

  constructor(
    options: GitHubInstallationAuthorizationProviderOptions
  ) {
    this.#appSlug = appSlug(options.appSlug);
    this.#setupCallbackUrl = secureUrl(
      options.setupCallbackUrl,
      "GitHub App setup callback URL"
    );
    this.#attestor = options.attestor;
  }

  async beginAuthorization(
    input: BeginConnectionAuthorizationInput
  ): Promise<BeginConnectionAuthorizationResult> {
    const requestedCallback = secureUrl(
      input.callbackUrl,
      "Connection callback URL"
    );
    if (requestedCallback !== this.#setupCallbackUrl) {
      throw new GitHubInstallationAuthorizationError(
        "GitHub authorization callback does not match the configured GitHub App setup URL."
      );
    }

    const url = new URL(
      "https://github.com/apps/" +
      this.#appSlug +
      "/installations/new"
    );
    url.searchParams.set("state", input.state);

    return Object.freeze({
      authorizationUrl: url.toString()
    });
  }

  async completeAuthorization(
    input: CompleteConnectionAuthorizationInput
  ): Promise<AuthorizedConnectionMetadata> {
    const id = installationId(
      input.callback.installation_id
    );

    const attested = await this.#attestor.attestInstallation({
      installationId: id,
      principalId: input.principalId,
      accountDomainId: input.accountDomainId
    });

    if (attested.installationId !== id) {
      throw new GitHubInstallationAuthorizationError(
        "GitHub installation attestation returned a different installation."
      );
    }

    return Object.freeze({
      providerAccountId: connectionProviderAccountId(id),
      providerDisplayName: attested.accountLogin,
      label:
        "GitHub " +
        attested.accountLogin +
        " (" +
        attested.accountType +
        ")",
      authenticationStrategy: "app_installation",
      capabilities: capabilities(attested.capabilities)
    });
  }

  async verifyAuthorization(
    input: VerifyConnectionAuthorizationInput
  ): Promise<VerifyConnectionAuthorizationResult> {
    const id = parseProviderAccountId(
      input.providerAccountId
    );

    const attested = await this.#attestor.verifyInstallation({
      installationId: id,
      principalId: input.principalId,
      accountDomainId: input.accountDomainId
    });

    if (!attested) {
      return Object.freeze({
        status: "reconnect_required",
        capabilities: Object.freeze([]),
        verifiedAt: new Date().toISOString()
      });
    }

    if (attested.installationId !== id) {
      throw new GitHubInstallationAuthorizationError(
        "GitHub installation verification returned a different installation."
      );
    }

    return Object.freeze({
      status: "active",
      capabilities: capabilities(attested.capabilities),
      verifiedAt: attested.verifiedAt
    });
  }

  async revokeAuthorization(
    _input: RevokeConnectionAuthorizationInput
  ): Promise<void> {
    // ASC revocation intentionally removes ASC authority only.
    // Uninstalling the GitHub App is a separate provider-admin action.
  }
}
