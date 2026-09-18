import type {
  DevelopmentIntelligenceClient,
  DevelopmentIntelligenceOverview,
  DevelopmentIntelligenceProjectStatus,
  DevelopmentIntelligenceSources
} from "./contracts.js";

const LEGACY_MCP_PROTOCOL_VERSION = "2025-11-25";

type FetchLike = typeof fetch;

interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc?: string;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

interface ToolCallResult {
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
  readonly content?: readonly unknown[];
}

export interface DevelopmentIntelligenceMcpHttpClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly fetchImpl?: FetchLike;
  readonly clientName?: string;
  readonly clientVersion?: string;
}

export class DevelopmentIntelligenceTransportError extends Error {
  readonly status?: number;
  readonly rpcCode?: number;

  constructor(message: string, options: { status?: number; rpcCode?: number } = {}) {
    super(message);
    this.name = "DevelopmentIntelligenceTransportError";
    if (options.status !== undefined) this.status = options.status;
    if (options.rpcCode !== undefined) this.rpcCode = options.rpcCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRpcResponse(value: unknown): JsonRpcResponse {
  if (!isRecord(value)) {
    throw new DevelopmentIntelligenceTransportError("Development Intelligence returned a non-object JSON-RPC response.");
  }

  const error = isRecord(value.error) &&
    typeof value.error.code === "number" &&
    typeof value.error.message === "string"
      ? {
          code: value.error.code,
          message: value.error.message,
          ...("data" in value.error ? { data: value.error.data } : {})
        }
      : undefined;

  return {
    ...("jsonrpc" in value && typeof value.jsonrpc === "string" ? { jsonrpc: value.jsonrpc } : {}),
    ...("id" in value ? { id: value.id } : {}),
    ...("result" in value ? { result: value.result } : {}),
    ...(error ? { error } : {})
  };
}

function asToolCallResult(value: unknown): ToolCallResult {
  if (!isRecord(value)) {
    throw new DevelopmentIntelligenceTransportError("Development Intelligence tools/call returned an invalid result.");
  }
  return {
    ...("structuredContent" in value ? { structuredContent: value.structuredContent } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(Array.isArray(value.content) ? { content: value.content } : {})
  };
}

function contentErrorText(content: readonly unknown[] | undefined): string | undefined {
  for (const item of content ?? []) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return item.text;
    }
  }
  return undefined;
}

function mcpUrl(baseUrl: string): string {
  return new URL("/mcp", baseUrl).toString();
}

export class DevelopmentIntelligenceMcpHttpClient implements DevelopmentIntelligenceClient {
  readonly #url: string;
  readonly #token: string | undefined;
  readonly #fetch: FetchLike;
  readonly #clientName: string;
  readonly #clientVersion: string;
  #nextId = 1;
  #initializePromise: Promise<void> | undefined;

  constructor(options: DevelopmentIntelligenceMcpHttpClientOptions) {
    this.#url = mcpUrl(options.baseUrl);
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#clientName = options.clientName ?? "ai-systems-control";
    this.#clientVersion = options.clientVersion ?? "0.1.0";
  }

  async #rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.#nextId++;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json"
    };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;

    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params
        })
      });
    } catch (error) {
      throw new DevelopmentIntelligenceTransportError(
        `Development Intelligence request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new DevelopmentIntelligenceTransportError(
        detail || `Development Intelligence returned HTTP ${response.status}.`,
        { status: response.status }
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DevelopmentIntelligenceTransportError("Development Intelligence returned invalid JSON.");
    }

    const rpc = asRpcResponse(payload);
    if (rpc.error) {
      throw new DevelopmentIntelligenceTransportError(
        rpc.error.message,
        { rpcCode: rpc.error.code }
      );
    }
    return rpc.result;
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initializePromise) {
      this.#initializePromise = (async () => {
        await this.#rpc("initialize", {
          protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: this.#clientName,
            version: this.#clientVersion
          }
        });
      })();
      this.#initializePromise.catch(() => {
        this.#initializePromise = undefined;
      });
    }
    await this.#initializePromise;
  }

  async #callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.#ensureInitialized();
    const result = asToolCallResult(
      await this.#rpc("tools/call", {
        name,
        arguments: args
      })
    );
    if (result.isError) {
      throw new DevelopmentIntelligenceTransportError(
        contentErrorText(result.content) ?? `Development Intelligence tool ${name} failed.`
      );
    }
    if (result.structuredContent === undefined) {
      throw new DevelopmentIntelligenceTransportError(
        `Development Intelligence tool ${name} returned no structuredContent.`
      );
    }
    return result.structuredContent as T;
  }

  async probe(): Promise<void> {
    await this.#ensureInitialized();
    await this.#rpc("ping");
  }

  async projectStatus(input: {
    readonly project: string;
    readonly checkUpstream?: boolean;
  }): Promise<DevelopmentIntelligenceProjectStatus> {
    return await this.#callTool<DevelopmentIntelligenceProjectStatus>("project_status", {
      project: input.project,
      checkUpstream: input.checkUpstream ?? true
    });
  }

  async projectOverview(input: {
    readonly project: string;
    readonly ref?: string;
  }): Promise<DevelopmentIntelligenceOverview> {
    return await this.#callTool<DevelopmentIntelligenceOverview>("project_overview", {
      project: input.project,
      ...(input.ref ? { ref: input.ref } : {})
    });
  }

  async listSources(input: {
    readonly project: string;
    readonly ref?: string;
  }): Promise<DevelopmentIntelligenceSources> {
    return await this.#callTool<DevelopmentIntelligenceSources>("list_sources", {
      project: input.project,
      ...(input.ref ? { ref: input.ref } : {})
    });
  }
}
