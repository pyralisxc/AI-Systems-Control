import { createHash } from "node:crypto";

import {
  McpServer,
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  requireBearerAuth,
  requireScopes,
  type AuthInfo
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  JwtMcpAccessTokenVerifier,
  SdkMcpOAuthTokenVerifier
} from "../../../dist/adapters/index.js";
import {
  AscBridgeToolService,
  McpRequestIdentityResolver
} from "../../../dist/application/index.js";
import type {
  AuthenticatedMcpCaller
} from "../../../dist/ports/index.js";
import {
  bridgedThreadServicesForDomain
} from "./thread-pulse";
import {
  identityRegistryServices
} from "./control-registry";
import {
  ASC_MCP_SCOPE_BASE,
  ASC_MCP_SCOPE_THREAD_READ,
  ASC_MCP_SCOPE_THREAD_WRITE,
  mcpAccountDomainClaim,
  mcpAllowedHostnames,
  mcpAllowedOriginHostnames,
  mcpOAuthIssuer,
  mcpOAuthJwksUrl,
  mcpResourceMetadataUrl,
  mcpResourceUrl,
  mcpScopeClaim
} from "./mcp-resource";

const profileOutputSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  nickname: z.string().optional()
});

const steeringSchema = z.object({
  actor: z.enum(["owner", "owner_assisted", "founder_relay"]),
  text: z.string().min(1),
  principalId: z.string().min(1).optional(),
  messageRef: z.string().min(1).optional()
}).strict();

const registerExternalSchema = z.object({
  title: z.string().min(1),
  purpose: z.string().optional(),
  projectId: z.string().optional(),
  mode: z.enum(["external", "bridged"]).optional(),
  provider: z.string().min(1),
  externalThreadId: z.string().optional(),
  navigationUrl: z.string().optional()
}).strict();

const checkpointSchema = z.object({
  threadId: z.string().min(1),
  synopsis: z.string().min(1),
  gate: z.enum(["none", "owner", "blocked", "waiting_external"]).optional(),
  blocker: z.string().optional(),
  workReferences: z.array(z.string()).optional(),
  evidenceReferences: z.array(z.string()).optional(),
  lastSteering: steeringSchema.optional()
}).strict();

const activitySchema = z.object({
  threadId: z.string().min(1),
  kind: z.enum([
    "meaningful_progress",
    "tool_success",
    "tool_failure",
    "heartbeat",
    "waiting",
    "owner_gate",
    "blocked",
    "completed",
    "stopped"
  ]),
  signature: z.string().optional(),
  summary: z.string().optional(),
  evidenceReference: z.string().optional()
}).strict();

const refineSchema = z.object({
  threadId: z.string().min(1),
  checkpointId: z.string().min(1),
  synopsis: z.string().min(1)
}).strict();

const getThreadSchema = z.object({
  threadId: z.string().min(1)
}).strict();

let cachedAuthConfigKey: string | undefined;
let cachedIdentityResolver: McpRequestIdentityResolver | undefined;
let cachedSdkVerifier: SdkMcpOAuthTokenVerifier | undefined;

function authConfigKey(): string {
  return [
    mcpOAuthIssuer(),
    mcpOAuthJwksUrl(),
    mcpResourceUrl(),
    mcpAccountDomainClaim(),
    mcpScopeClaim()
  ].join("\u0000");
}

async function authServices() {
  const key = authConfigKey();
  if (
    cachedIdentityResolver &&
    cachedSdkVerifier &&
    cachedAuthConfigKey === key
  ) {
    return {
      resolver: cachedIdentityResolver,
      verifier: cachedSdkVerifier
    };
  }

  const { identities } = await identityRegistryServices();
  const tokenVerifier = new JwtMcpAccessTokenVerifier({
    issuer: mcpOAuthIssuer(),
    audience: mcpResourceUrl(),
    jwksUrl: mcpOAuthJwksUrl(),
    accountDomainClaim: mcpAccountDomainClaim(),
    scopeClaim: mcpScopeClaim()
  });
  const resolver = new McpRequestIdentityResolver({
    verifier: tokenVerifier,
    identities
  });
  const verifier = new SdkMcpOAuthTokenVerifier(resolver);

  cachedAuthConfigKey = key;
  cachedIdentityResolver = resolver;
  cachedSdkVerifier = verifier;
  return { resolver, verifier };
}

function structured(value: unknown): Record<string, unknown> {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  return { value: value ?? null };
}

function toolResult(value: unknown) {
  const result = structured(value);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result)
      }
    ],
    structuredContent: result
  };
}

function profileId(caller: AuthenticatedMcpCaller): string {
  const digest = createHash("sha256")
    .update(
      caller.principalId +
      "\u0000" +
      caller.accountDomainId
    )
    .digest("base64url")
    .slice(0, 32);
  return "asc_profile_" + digest;
}

async function bridgeForCaller(caller: AuthenticatedMcpCaller) {
  const services = await bridgedThreadServicesForDomain(
    caller.accountDomainId
  );
  return {
    services,
    tools: new AscBridgeToolService({
      bridge: services.bridge,
      identities: services.control.identities,
      accountDomainId: caller.accountDomainId
    })
  };
}

function readSecurity() {
  return [{ type: "oauth2" as const, scopes: [ASC_MCP_SCOPE_THREAD_READ] }];
}

function writeSecurity() {
  return [{ type: "oauth2" as const, scopes: [ASC_MCP_SCOPE_THREAD_WRITE] }];
}

export async function buildAscMcpServer(
  authInfo: AuthInfo
): Promise<McpServer> {
  const { resolver } = await authServices();
  const caller = await resolver.resolve(authInfo.token, [ASC_MCP_SCOPE_BASE]);
  const { services, tools } = await bridgeForCaller(caller);

  const server = new McpServer({
    name: "AI Systems Control",
    version: "0.2.0"
  });

  server.registerTool(
    "get_profile",
    {
      title: "ASC Profile",
      description:
        "Return the ASC profile represented by this request's authenticated credentials.",
      inputSchema: z.object({}).strict(),
      outputSchema: profileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: [
        { type: "oauth2", scopes: [ASC_MCP_SCOPE_BASE] }
      ],
      _meta: {
        "openai/profile": true
      }
    },
    async () => {
      const principal = await services.control.identities.getPrincipal(
        caller.principalId
      );
      const domain = await services.control.identities.assertActiveDomain(
        caller.accountDomainId
      );
      if (!principal) {
        throw new Error("Authenticated ASC Principal is unavailable.");
      }

      const profile = {
        id: profileId(caller),
        name: principal.displayName,
        nickname: principal.displayName + " — " + domain.name
      };
      return {
        isError: false,
        structuredContent: profile,
        content: [
          {
            type: "text",
            text: JSON.stringify(profile)
          }
        ]
      };
    }
  );

  server.registerTool(
    "thread.list_pulse",
    {
      title: "List ASC Pulse",
      description:
        "List normalized ASC Pulse projections for the authenticated AccountDomain.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: readSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_READ)
    },
    async () =>
      toolResult(
        await tools.call(
          "thread.list_pulse",
          {},
          {
            principalId: caller.principalId,
            source: "mcp"
          }
        )
      )
  );

  server.registerTool(
    "thread.get",
    {
      title: "Get ASC Thread",
      description:
        "Read one durable ASC Thread with checkpoints, activity, and Relay history.",
      inputSchema: getThreadSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: readSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_READ)
    },
    async (args) =>
      toolResult(
        await tools.call("thread.get", args, {
          principalId: caller.principalId,
          source: "mcp"
        })
      )
  );

  server.registerTool(
    "thread.register_external",
    {
      title: "Register External ASC Thread",
      description:
        "Attach an external conversation to ASC without claiming runtime control.",
      inputSchema: registerExternalSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: writeSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_WRITE)
    },
    async (args) =>
      toolResult(
        await tools.call("thread.register_external", args, {
          principalId: caller.principalId,
          source: "mcp"
        })
      )
  );

  server.registerTool(
    "thread.publish_checkpoint",
    {
      title: "Publish ASC Thread Checkpoint",
      description:
        "Publish a synopsis, gate, work references, and evidence references into a bridged ASC Thread.",
      inputSchema: checkpointSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: writeSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_WRITE)
    },
    async (args) =>
      toolResult(
        await tools.call("thread.publish_checkpoint", args, {
          principalId: caller.principalId,
          source: "mcp"
        })
      )
  );

  server.registerTool(
    "thread.publish_activity",
    {
      title: "Publish ASC Thread Activity",
      description:
        "Publish observable runtime/tool activity used by ASC Pulse.",
      inputSchema: activitySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: writeSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_WRITE)
    },
    async (args) =>
      toolResult(
        await tools.call("thread.publish_activity", args, {
          principalId: caller.principalId,
          source: "mcp"
        })
      )
  );

  server.registerTool(
    "thread.refine_synopsis",
    {
      title: "Refine ASC Thread Synopsis",
      description:
        "Create a human owner-refined synopsis checkpoint without rewriting prior history.",
      inputSchema: refineSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false
      },
      securitySchemes: writeSecurity(),
      scopeChallenge: requireScopes(ASC_MCP_SCOPE_THREAD_WRITE)
    },
    async (args) =>
      toolResult(
        await tools.call("thread.refine_synopsis", args, {
          principalId: caller.principalId,
          source: "mcp"
        })
      )
  );

  return server;
}

const handler = createMcpHandler(
  async ({ authInfo }) => {
    if (!authInfo) {
      throw new Error("Authenticated MCP request context is required.");
    }
    return buildAscMcpServer(authInfo);
  },
  { responseMode: "json" }
);

let cachedGateKey: string | undefined;
let cachedGate:
  | Awaited<ReturnType<typeof createBearerGate>>
  | undefined;

async function createBearerGate() {
  const { verifier } = await authServices();
  return requireBearerAuth({
    verifier,
    requiredScopes: [ASC_MCP_SCOPE_BASE],
    resourceMetadataUrl: mcpResourceMetadataUrl()
  });
}

async function bearerGate() {
  const key = authConfigKey();
  if (!cachedGate || cachedGateKey !== key) {
    cachedGate = await createBearerGate();
    cachedGateKey = key;
  }
  return cachedGate;
}

export async function serveAscMcp(
  request: Request
): Promise<Response> {
  const rejected =
    hostHeaderValidationResponse(request, mcpAllowedHostnames()) ??
    originValidationResponse(request, mcpAllowedOriginHostnames());
  if (rejected) return rejected;

  const gate = await bearerGate();
  const authInfo = await gate(request);
  if (authInfo instanceof Response) return authInfo;

  return handler.fetch(request, { authInfo });
}
