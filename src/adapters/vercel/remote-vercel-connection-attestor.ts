import type {
  AttestExternalRepositoryInput,
  ExternalConnectionAttestor,
  ExternalConnectionMetadata,
  ExternalRepositoryAttestation
} from "../../ports/index.js";

export interface RemoteVercelConnectionAttestorOptions {
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
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

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Conductor provider bridge URL must not contain credentials, query, or fragment."
    );
  }

  const serialized = url.toString();
  return serialized.endsWith("/")
    ? serialized.slice(0, -1)
    : serialized;
}

function serviceSecret(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 32 ||
    normalized.length > 4096
  ) {
    throw new Error(
      "Conductor provider bridge secret must contain 32-4096 characters."
    );
  }
  return normalized;
}

function record(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
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

function optionalString(
  value: unknown
): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function iso(
  value: unknown,
  label: string
): string {
  const raw = stringField(value, label);
  if (!Number.isFinite(Date.parse(raw))) {
    throw new Error(label + " is invalid.");
  }
  return raw;
}

function installationId(value: string): string {
  const normalized = value.trim();
  if (!/^icfg_[A-Za-z0-9_-]+$/u.test(normalized)) {
    throw new Error(
      "Vercel installation ID is invalid."
    );
  }
  return normalized;
}

function projectId(value: unknown): string {
  const raw = stringField(
    value,
    "Vercel project ID"
  );
  if (!/^prj_[A-Za-z0-9]+$/u.test(raw)) {
    throw new Error(
      "Vercel project ID is invalid."
    );
  }
  return raw;
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
      "Repository must be owner/repository."
    );
  }
  return Object.freeze({
    canonical: pieces[0] + "/" + pieces[1],
    owner: pieces[0],
    name: pieces[1]
  });
}

function capabilities(
  value: unknown
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      "Vercel attestation capabilities are invalid."
    );
  }
  return Object.freeze(
    [...new Set(
      value
        .map((entry) => entry.trim())
        .filter(Boolean)
    )].sort()
  );
}

function accountMetadata(
  teamId: string | undefined
): {
  readonly accountReference: string;
  readonly accountDisplayName: string;
  readonly accountType: string;
} {
  if (teamId) {
    return Object.freeze({
      accountReference: teamId,
      accountDisplayName: teamId,
      accountType: "Team"
    });
  }
  return Object.freeze({
    accountReference: "personal",
    accountDisplayName: "Personal Vercel account",
    accountType: "Personal"
  });
}

export class RemoteVercelConnectionAttestor
  implements ExternalConnectionAttestor
{
  readonly #baseUrl: string;
  readonly #secret: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;

  constructor(
    options: RemoteVercelConnectionAttestorOptions
  ) {
    this.#baseUrl = secureBaseUrl(options.baseUrl);
    this.#secret = serviceSecret(options.secret);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
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
        "Conductor Vercel attestation failed with HTTP " +
        response.status +
        "."
      );
    }

    const value: unknown = await response.json();
    if (!record(value)) {
      throw new Error(
        "Conductor Vercel attestation response is invalid."
      );
    }
    return value;
  }

  async listConnections():
    Promise<readonly ExternalConnectionMetadata[]> {
    const value = await this.#get(
      "/internal/asc/vercel/installations"
    );
    if (!Array.isArray(value.installations)) {
      throw new Error(
        "Conductor Vercel installation list is invalid."
      );
    }

    const observedAt = this.#now().toISOString();
    const result = value.installations.map((entry) => {
      if (!record(entry)) {
        throw new Error(
          "Conductor Vercel installation metadata is invalid."
        );
      }
      const connectionReference = installationId(
        stringField(
          entry.configurationId,
          "Vercel installation ID"
        )
      );
      const teamId = optionalString(entry.teamId);
      const account = accountMetadata(teamId);
      return Object.freeze({
        connectionReference,
        ...account,
        connectedAt: iso(
          entry.connectedAt,
          "Vercel connected time"
        ),
        observedAt
      });
    });

    return Object.freeze(result);
  }

  async attestRepository(
    input: AttestExternalRepositoryInput
  ): Promise<ExternalRepositoryAttestation> {
    const connectionReference =
      installationId(input.connectionReference);
    const requested = repository(input.repository);
    const value = await this.#get(
      "/internal/asc/vercel/installations/" +
      encodeURIComponent(connectionReference) +
      "/repositories/" +
      encodeURIComponent(requested.owner) +
      "/" +
      encodeURIComponent(requested.name) +
      "/attest"
    );

    const returnedConnection =
      installationId(
        stringField(
          value.connectionId,
          "Vercel connection ID"
        )
      );
    if (returnedConnection !== connectionReference) {
      throw new Error(
        "Conductor attested a different Vercel installation."
      );
    }

    const returnedRepository = repository(
      stringField(
        value.repository,
        "Vercel repository"
      )
    ).canonical;
    if (
      returnedRepository.toLowerCase() !==
      requested.canonical.toLowerCase()
    ) {
      throw new Error(
        "Conductor attested a different repository for Vercel."
      );
    }

    const teamId = optionalString(value.teamId);
    const account = accountMetadata(teamId);
    const resource = projectId(value.projectId);
    const displayName = stringField(
      value.projectName,
      "Vercel project name"
    );

    return Object.freeze({
      connectionReference: returnedConnection,
      repository: returnedRepository,
      ...account,
      capabilities: capabilities(value.capabilities),
      verifiedAt: iso(
        value.verifiedAt,
        "Vercel verification time"
      ),
      resource: Object.freeze({
        kind: "vercel_project",
        value: resource
      }),
      resourceDisplayName: displayName
    });
  }
}
