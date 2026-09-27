import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload
} from "jose";

import {
  McpAuthenticationError,
  type McpAccessTokenVerifier,
  type VerifiedMcpAccessToken
} from "../../ports/index.js";

export interface JwtMcpAccessTokenVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly accountDomainClaim?: string;
  readonly scopeClaim?: string;
}

function httpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(label + " must be an absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error(label + " must use HTTPS.");
  }
  return url.toString().replace(//$/u, "");
}

function stringClaim(
  payload: JWTPayload,
  claim: string,
  label: string
): string {
  const value = payload[claim];
  if (typeof value !== "string" || !value.trim()) {
    throw new McpAuthenticationError(label + " is missing from access token.");
  }
  return value.trim();
}

function scopesFromClaim(
  payload: JWTPayload,
  claim: string
): readonly string[] {
  const value = payload[claim];
  if (typeof value === "string") {
    return Object.freeze(
      [...new Set(value.split(/\s+/u).map((scope) => scope.trim()).filter(Boolean))]
    );
  }
  if (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === "string")
  ) {
    return Object.freeze(
      [...new Set(value.map((scope) => scope.trim()).filter(Boolean))]
    );
  }
  return Object.freeze([]);
}

function audienceList(payload: JWTPayload): readonly string[] {
  const value = payload.aud;
  if (typeof value === "string") return Object.freeze([value]);
  if (Array.isArray(value)) {
    return Object.freeze(
      value.filter((entry): entry is string => typeof entry === "string")
    );
  }
  return Object.freeze([]);
}

export class JwtMcpAccessTokenVerifier implements McpAccessTokenVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #accountDomainClaim: string;
  readonly #scopeClaim: string;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: JwtMcpAccessTokenVerifierOptions) {
    this.#issuer = httpsUrl(options.issuer, "OAuth issuer");
    this.#audience = httpsUrl(options.audience, "OAuth resource/audience");
    this.#accountDomainClaim =
      options.accountDomainClaim?.trim() || "asc_account_domain_id";
    this.#scopeClaim = options.scopeClaim?.trim() || "scope";
    this.#jwks = createRemoteJWKSet(
      new URL(httpsUrl(options.jwksUrl, "OAuth JWKS URL"))
    );
  }

  async verify(token: string): Promise<VerifiedMcpAccessToken> {
    const compact = token.trim();
    if (!compact) throw new McpAuthenticationError("Access token is required.");

    try {
      const { payload } = await jwtVerify(compact, this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience
      });

      if (typeof payload.sub !== "string" || !payload.sub.trim()) {
        throw new McpAuthenticationError(
          "Access token subject is missing."
        );
      }
      if (typeof payload.exp !== "number") {
        throw new McpAuthenticationError(
          "Access token expiry is missing."
        );
      }

      return Object.freeze({
        issuer: this.#issuer,
        subject: payload.sub.trim(),
        accountDomainId: stringClaim(
          payload,
          this.#accountDomainClaim,
          "AccountDomain claim"
        ),
        audience: audienceList(payload),
        scopes: scopesFromClaim(payload, this.#scopeClaim),
        expiresAt: payload.exp
      });
    } catch (error) {
      if (error instanceof McpAuthenticationError) throw error;
      throw new McpAuthenticationError(
        "Access token failed signature, issuer, audience, or time validation."
      );
    }
  }
}
