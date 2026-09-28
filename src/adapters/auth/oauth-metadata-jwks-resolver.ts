export type OAuthJwksDiscoverySource =
  | "oauth_metadata"
  | "oidc_metadata";

export interface OAuthJwksDiscoveryResult {
  readonly jwksUrl: string;
  readonly source: OAuthJwksDiscoverySource;
  readonly metadataUrl: string;
}

export interface OAuthMetadataFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Uint8Array;
}

export type OAuthMetadataFetcher = (
  url: string,
  signal: AbortSignal
) => Promise<OAuthMetadataFetchResponse>;

export class OAuthMetadataDiscoveryError extends Error {
  readonly code = "oauth_metadata_discovery_failed";

  constructor(message: string) {
    super(message);
    this.name = "OAuthMetadataDiscoveryError";
  }
}

function secureUrl(
  value: string,
  label: string
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthMetadataDiscoveryError(
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
    throw new OAuthMetadataDiscoveryError(
      label + " must use HTTPS outside localhost development."
    );
  }

  if (url.search || url.hash) {
    throw new OAuthMetadataDiscoveryError(
      label + " must not contain a query or fragment."
    );
  }

  return url;
}

export function normalizeOAuthIssuer(
  issuer: string
): string {
  const url = secureUrl(issuer.trim(), "OAuth issuer");
  const serialized = url.toString();
  return serialized.endsWith("/")
    ? serialized.slice(0, -1)
    : serialized;
}

export function oauthAuthorizationServerMetadataUrl(
  issuer: string
): string {
  const normalized = new URL(normalizeOAuthIssuer(issuer));
  const issuerPath =
    normalized.pathname === "/"
      ? ""
      : normalized.pathname;

  return new URL(
    "/.well-known/oauth-authorization-server" + issuerPath,
    normalized.origin
  ).toString();
}

export function oidcDiscoveryMetadataUrl(
  issuer: string
): string {
  const normalized = normalizeOAuthIssuer(issuer);
  return normalized + "/.well-known/openid-configuration";
}

function validateJwksUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OAuthMetadataDiscoveryError(
      "Authorization server metadata does not contain jwks_uri."
    );
  }

  const url = secureUrl(value.trim(), "OAuth metadata jwks_uri");
  return url.toString();
}

function parseMetadata(
  body: Uint8Array,
  expectedIssuer: string
): string {
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body)
    );
  } catch {
    throw new OAuthMetadataDiscoveryError(
      "Authorization server metadata is not valid UTF-8 JSON."
    );
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new OAuthMetadataDiscoveryError(
      "Authorization server metadata must be a JSON object."
    );
  }

  const metadata = payload as Record<string, unknown>;
  if (metadata.issuer !== expectedIssuer) {
    throw new OAuthMetadataDiscoveryError(
      "Authorization server metadata issuer does not exactly match configured issuer."
    );
  }

  return validateJwksUrl(metadata.jwks_uri);
}

export class OAuthMetadataJwksResolver {
  readonly #fetcher: OAuthMetadataFetcher;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  constructor(input: {
    readonly fetcher?: OAuthMetadataFetcher;
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
  } = {}) {
    this.#fetcher = input.fetcher ?? defaultMetadataFetcher;
    this.#timeoutMs = input.timeoutMs ?? 5_000;
    this.#maxBytes = input.maxBytes ?? 64 * 1024;

    if (
      !Number.isInteger(this.#timeoutMs) ||
      this.#timeoutMs < 100 ||
      this.#timeoutMs > 30_000
    ) {
      throw new Error(
        "OAuth metadata timeout must be between 100 and 30000 ms."
      );
    }
    if (
      !Number.isInteger(this.#maxBytes) ||
      this.#maxBytes < 1024 ||
      this.#maxBytes > 1024 * 1024
    ) {
      throw new Error(
        "OAuth metadata maxBytes must be between 1024 and 1048576."
      );
    }
  }

  async resolve(
    issuerInput: string
  ): Promise<OAuthJwksDiscoveryResult> {
    const issuer = normalizeOAuthIssuer(issuerInput);
    const candidates = [
      {
        source: "oauth_metadata" as const,
        url: oauthAuthorizationServerMetadataUrl(issuer)
      },
      {
        source: "oidc_metadata" as const,
        url: oidcDiscoveryMetadataUrl(issuer)
      }
    ];

    for (const [index, candidate] of candidates.entries()) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.#timeoutMs
      );

      let response: OAuthMetadataFetchResponse;
      try {
        response = await this.#fetcher(
          candidate.url,
          controller.signal
        );
      } catch (error) {
        clearTimeout(timeout);
        if (index === candidates.length - 1) {
          throw new OAuthMetadataDiscoveryError(
            error instanceof Error
              ? "OAuth metadata discovery failed: " + error.message
              : "OAuth metadata discovery failed."
          );
        }
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        if (index === candidates.length - 1) {
          throw new OAuthMetadataDiscoveryError(
            "OAuth metadata discovery failed with HTTP " +
            response.status + "."
          );
        }
        continue;
      }

      if (response.body.byteLength > this.#maxBytes) {
        throw new OAuthMetadataDiscoveryError(
          "Authorization server metadata exceeds the allowed size."
        );
      }

      return Object.freeze({
        jwksUrl: parseMetadata(response.body, issuer),
        source: candidate.source,
        metadataUrl: candidate.url
      });
    }

    throw new OAuthMetadataDiscoveryError(
      "OAuth authorization server metadata is unavailable."
    );
  }
}

async function defaultMetadataFetcher(
  url: string,
  signal: AbortSignal
): Promise<OAuthMetadataFetchResponse> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json"
    }
  });

  const body = new Uint8Array(await response.arrayBuffer());
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    body
  });
}
