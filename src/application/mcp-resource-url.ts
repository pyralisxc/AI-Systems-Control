export type McpResourceUrlSource =
  | "explicit"
  | "vercel_branch";

export interface DerivedMcpResourceUrl {
  readonly resourceUrl: string;
  readonly source: McpResourceUrlSource;
}

function secureOrigin(
  value: string,
  label: string
): URL {
  const candidate = value.includes("://")
    ? value
    : "https://" + value;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(label + " must be a valid URL or hostname.");
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
      label + " must use HTTPS outside localhost development."
    );
  }

  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      label + " must identify an origin/hostname without a path, query, or fragment."
    );
  }

  return url;
}

function normalizeExplicitResource(
  value: string
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "ASC_MCP_RESOURCE_URL must be an absolute URL."
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
      "ASC_MCP_RESOURCE_URL must use HTTPS outside localhost development."
    );
  }

  const serialized = url.toString();
  return serialized.endsWith("/")
    ? serialized.slice(0, -1)
    : serialized;
}

export function deriveMcpResourceUrl(input: {
  readonly explicitResourceUrl?: string;
  readonly vercelBranchUrl?: string;
}): DerivedMcpResourceUrl | undefined {
  const explicit = input.explicitResourceUrl?.trim();
  if (explicit) {
    return Object.freeze({
      resourceUrl: normalizeExplicitResource(explicit),
      source: "explicit"
    });
  }

  const branch = input.vercelBranchUrl?.trim();
  if (!branch) return undefined;

  const origin = secureOrigin(
    branch,
    "VERCEL_BRANCH_URL"
  );

  return Object.freeze({
    resourceUrl: new URL("/mcp", origin).toString(),
    source: "vercel_branch"
  });
}
