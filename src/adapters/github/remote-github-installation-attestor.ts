import type {
  GitHubAppIdentity,
  GitHubInstallationAttestation,
  GitHubInstallationAttestor
} from "./github-installation-authorization-provider.js";
import type {
  AttestGitHubRepositoryInput,
  GitHubRepositoryAttestation,
  GitHubRepositoryAttestor
} from "../../ports/index.js";

export interface RemoteGitHubInstallationAttestorOptions {
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetch?: typeof globalThis.fetch;
}

function secureBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "Conductor provider bridge URL must be absolute."
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
    throw new Error(
      "Conductor provider bridge URL must use HTTPS outside localhost."
    );
  }

  if (url.search || url.hash) {
    throw new Error(
      "Conductor provider bridge URL must not contain query or fragment."
    );
  }

  const serialized = url.toString();
  return serialized.endsWith("/")
    ? serialized.slice(0, -1)
    : serialized;
}

function serviceSecret(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 32) {
    throw new Error(
      "Conductor provider bridge secret must be at least 32 characters."
    );
  }
  return normalized;
}

function installationId(value: string): string {
  const normalized = value.trim();
  if (!/^[1-9][0-9]{0,19}$/u.test(normalized)) {
    throw new Error("GitHub installation ID is invalid.");
  }
  return normalized;
}

function repository(value: string): {
  readonly canonical: string;
  readonly owner: string;
  readonly name: string;
} {
  const pieces = value.trim().split("/");
  if (
    pieces.length !== 2 ||
    !pieces[0] ||
    !pieces[1] ||
    !/^[A-Za-z0-9_.-]+$/u.test(pieces[0]) ||
    !/^[A-Za-z0-9_.-]+$/u.test(pieces[1])
  ) {
    throw new Error(
      "GitHub repository must be owner/repository."
    );
  }

  return Object.freeze({
    canonical: pieces[0] + "/" + pieces[1],
    owner: pieces[0],
    name: pieces[1]
  });
}

function stringField(
  value: unknown,
  label: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is missing.");
  }
  return value.trim();
}

function accountType(
  value: unknown
): "User" | "Organization" | "Enterprise" {
  const raw = stringField(value, "GitHub account type");
  if (
    raw !== "User" &&
    raw !== "Organization" &&
    raw !== "Enterprise"
  ) {
    throw new Error(
      "GitHub account type is invalid."
    );
  }
  return raw;
}

function verifiedAt(value: unknown): string {
  const raw = stringField(
    value,
    "GitHub attestation time"
  );
  if (!Number.isFinite(Date.parse(raw))) {
    throw new Error(
      "GitHub attestation time is invalid."
    );
  }
  return raw;
}

function safeCapabilities(
  value: unknown
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      "GitHub attestation capabilities are invalid."
    );
  }

  return Object.freeze([
    ...new Set(
      value.map((entry) => entry.trim()).filter(Boolean)
    )
  ].sort());
}

export class RemoteGitHubInstallationAttestor
  implements GitHubInstallationAttestor, GitHubRepositoryAttestor
{
  readonly #baseUrl: string;
  readonly #secret: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(
    options: RemoteGitHubInstallationAttestorOptions
  ) {
    this.#baseUrl = secureBaseUrl(options.baseUrl);
    this.#secret = serviceSecret(options.secret);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async #get(path: string): Promise<Record<string, unknown>> {
    const response = await this.#fetch(
      this.#baseUrl + path,
      {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: "Bearer " + this.#secret
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        "Conductor GitHub attestation failed with HTTP " +
        response.status +
        "."
      );
    }

    const value = await response.json();
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error(
        "Conductor GitHub attestation response is invalid."
      );
    }

    return value as Record<string, unknown>;
  }

  async getAppIdentity(): Promise<GitHubAppIdentity> {
    const value = await this.#get(
      "/internal/asc/github/app"
    );

    return Object.freeze({
      appId: stringField(value.appId, "GitHub App ID"),
      appSlug: stringField(
        value.appSlug,
        "GitHub App slug"
      )
    });
  }

  async attestInstallation(input: {
    readonly installationId: string;
    readonly principalId: string;
    readonly accountDomainId: string;
  }): Promise<GitHubInstallationAttestation> {
    return this.#attest(input.installationId);
  }

  async verifyInstallation(input: {
    readonly installationId: string;
    readonly principalId: string;
    readonly accountDomainId: string;
  }): Promise<GitHubInstallationAttestation | undefined> {
    try {
      return await this.#attest(input.installationId);
    } catch {
      return undefined;
    }
  }

  async attestRepository(
    input: AttestGitHubRepositoryInput
  ): Promise<GitHubRepositoryAttestation> {
    const id = installationId(input.installationId);
    const requested = repository(input.repository);
    const value = await this.#get(
      "/internal/asc/github/installations/" +
      encodeURIComponent(id) +
      "/repositories/" +
      encodeURIComponent(requested.owner) +
      "/" +
      encodeURIComponent(requested.name) +
      "/attest"
    );

    const returnedId = installationId(
      stringField(
        value.installationId,
        "GitHub installation ID"
      )
    );
    if (returnedId !== id) {
      throw new Error(
        "Conductor attested a different GitHub installation."
      );
    }

    const returnedRepository = repository(
      stringField(
        value.repository,
        "GitHub repository"
      )
    ).canonical;
    if (
      returnedRepository.toLowerCase() !==
      requested.canonical.toLowerCase()
    ) {
      throw new Error(
        "Conductor attested a different GitHub repository."
      );
    }

    return Object.freeze({
      installationId: returnedId,
      repository: returnedRepository,
      accountId: stringField(
        value.accountId,
        "GitHub account ID"
      ),
      accountLogin: stringField(
        value.accountLogin,
        "GitHub account login"
      ),
      accountType: accountType(value.accountType),
      capabilities: safeCapabilities(value.capabilities),
      verifiedAt: verifiedAt(value.verifiedAt)
    });
  }

  async #attest(
    installationIdInput: string
  ): Promise<GitHubInstallationAttestation> {
    const id = installationId(
      installationIdInput
    );
    const value = await this.#get(
      "/internal/asc/github/installations/" +
      encodeURIComponent(id) +
      "/attest"
    );

    const returnedId = installationId(
      stringField(
        value.installationId,
        "GitHub installation ID"
      )
    );
    if (returnedId !== id) {
      throw new Error(
        "Conductor attested a different GitHub installation."
      );
    }

    const repositorySelectionRaw = stringField(
      value.repositorySelection,
      "GitHub repository selection"
    );
    if (
      repositorySelectionRaw !== "all" &&
      repositorySelectionRaw !== "selected"
    ) {
      throw new Error(
        "GitHub repository selection is invalid."
      );
    }

    return Object.freeze({
      installationId: returnedId,
      accountId: stringField(
        value.accountId,
        "GitHub account ID"
      ),
      accountLogin: stringField(
        value.accountLogin,
        "GitHub account login"
      ),
      accountType: accountType(value.accountType),
      repositorySelection: repositorySelectionRaw,
      capabilities: safeCapabilities(
        value.capabilities
      ),
      verifiedAt: verifiedAt(value.verifiedAt)
    });
  }
}
