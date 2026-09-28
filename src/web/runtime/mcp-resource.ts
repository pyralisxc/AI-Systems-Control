import {
  deriveMcpResourceUrl,
  type McpResourceUrlSource
} from "../../../dist/application/index.js";
import {
  OAuthMetadataJwksResolver,
  type OAuthJwksDiscoverySource
} from "../../../dist/adapters/index.js";

export const ASC_MCP_SCOPE_BASE = "asc.mcp";
export const ASC_MCP_SCOPE_THREAD_READ = "asc.thread.read";
export const ASC_MCP_SCOPE_THREAD_WRITE = "asc.thread.write";

export const ASC_MCP_SCOPES = Object.freeze([
  ASC_MCP_SCOPE_BASE,
  ASC_MCP_SCOPE_THREAD_READ,
  ASC_MCP_SCOPE_THREAD_WRITE
]);

function absoluteUrl(
  value: string | undefined,
  label: string
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(label + " is not configured.");
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(label + " must be an absolute URL.");
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      label + " must use HTTPS outside localhost development."
    );
  }

  const serialized = url.toString();
  return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
}

function resolvedMcpResource():
  | {
      readonly resourceUrl: string;
      readonly source: McpResourceUrlSource;
    }
  | undefined {
  const explicitResourceUrl =
    process.env.ASC_MCP_RESOURCE_URL?.trim();
  const vercelBranchUrl =
    process.env.VERCEL_BRANCH_URL?.trim();

  return deriveMcpResourceUrl({
    ...(explicitResourceUrl
      ? { explicitResourceUrl }
      : {}),
    ...(vercelBranchUrl
      ? { vercelBranchUrl }
      : {})
  });
}

export function mcpResourceUrl(): string {
  const resolved = resolvedMcpResource();
  if (!resolved) {
    throw new Error(
      "ASC MCP resource URL is not configured and VERCEL_BRANCH_URL is unavailable."
    );
  }
  return resolved.resourceUrl;
}

export function mcpResourceUrlSource(): McpResourceUrlSource | undefined {
  return resolvedMcpResource()?.source;
}

export function mcpOAuthIssuer(): string {
  return absoluteUrl(
    process.env.ASC_OAUTH_ISSUER,
    "ASC_OAUTH_ISSUER"
  );
}

export type McpOAuthJwksSource =
  | "explicit"
  | OAuthJwksDiscoverySource;

export interface McpOAuthJwksResolution {
  readonly jwksUrl: string;
  readonly source: McpOAuthJwksSource;
}

let cachedJwksKey: string | undefined;
let cachedJwksPromise:
  | Promise<McpOAuthJwksResolution>
  | undefined;

function explicitMcpOAuthJwksUrl(): string | undefined {
  const value = process.env.ASC_OAUTH_JWKS_URL?.trim();
  return value
    ? absoluteUrl(value, "ASC_OAUTH_JWKS_URL")
    : undefined;
}

export async function resolveMcpOAuthJwks():
  Promise<McpOAuthJwksResolution> {
  const issuer = mcpOAuthIssuer();
  const explicit = explicitMcpOAuthJwksUrl();
  if (explicit) {
    return Object.freeze({
      jwksUrl: explicit,
      source: "explicit"
    });
  }

  const key = issuer;
  if (cachedJwksPromise && cachedJwksKey === key) {
    return cachedJwksPromise;
  }

  cachedJwksKey = key;
  cachedJwksPromise = new OAuthMetadataJwksResolver()
    .resolve(issuer)
    .then((result) =>
      Object.freeze({
        jwksUrl: result.jwksUrl,
        source: result.source
      })
    )
    .catch((error) => {
      if (cachedJwksKey === key) {
        cachedJwksKey = undefined;
        cachedJwksPromise = undefined;
      }
      throw error;
    });

  return cachedJwksPromise;
}

export function mcpAccountDomainClaim(): string {
  return (
    process.env.ASC_MCP_ACCOUNT_DOMAIN_CLAIM?.trim() ||
    "asc_account_domain_id"
  );
}

export function mcpScopeClaim(): string {
  return process.env.ASC_MCP_SCOPE_CLAIM?.trim() || "scope";
}

export function mcpResourceDocumentationUrl(): string | undefined {
  const value = process.env.ASC_MCP_DOCUMENTATION_URL?.trim();
  return value ? absoluteUrl(value, "ASC_MCP_DOCUMENTATION_URL") : undefined;
}

export function mcpResourceMetadataUrl(): string {
  const resource = new URL(mcpResourceUrl());
  const path =
    resource.pathname === "/"
      ? ""
      : resource.pathname.endsWith("/")
        ? resource.pathname.slice(0, -1)
        : resource.pathname;
  return new URL(
    "/.well-known/oauth-protected-resource" + path,
    resource.origin
  ).toString();
}

export interface AscProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly resource_documentation?: string;
}

export function protectedResourceMetadata(): AscProtectedResourceMetadata {
  const documentation = mcpResourceDocumentationUrl();
  return Object.freeze({
    resource: mcpResourceUrl(),
    authorization_servers: Object.freeze([mcpOAuthIssuer()]),
    scopes_supported: ASC_MCP_SCOPES,
    ...(documentation
      ? { resource_documentation: documentation }
      : {})
  });
}

export function mcpOAuthConfigured(): boolean {
  return Boolean(
    resolvedMcpResource() &&
    process.env.ASC_OAUTH_ISSUER?.trim()
  );
}


function hostnameList(
  value: string | undefined,
  label: string
): readonly string[] {
  if (!value?.trim()) return Object.freeze([]);

  const results = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes("://")) {
        let url: URL;
        try {
          url = new URL(entry);
        } catch {
          throw new Error(label + " contains an invalid URL.");
        }
        return url.hostname;
      }

      if (
        entry.includes("/") ||
        entry.includes("?") ||
        entry.includes("#")
      ) {
        throw new Error(
          label + " entries must be hostnames or absolute URLs."
        );
      }
      return entry.replace(/:\d+$/u, "");
    });

  return Object.freeze([...new Set(results)]);
}

export function mcpAllowedHostnames(): readonly string[] {
  const resource = new URL(mcpResourceUrl());
  return Object.freeze([
    resource.hostname,
    ...hostnameList(
      process.env.ASC_MCP_ALLOWED_HOSTS,
      "ASC_MCP_ALLOWED_HOSTS"
    )
  ]);
}

export function mcpAllowedOriginHostnames(): readonly string[] {
  const resource = new URL(mcpResourceUrl());
  return Object.freeze([
    resource.hostname,
    ...hostnameList(
      process.env.ASC_MCP_ALLOWED_ORIGINS,
      "ASC_MCP_ALLOWED_ORIGINS"
    )
  ]);
}
