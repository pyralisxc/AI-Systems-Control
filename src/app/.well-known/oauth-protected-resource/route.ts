import {
  mcpOAuthConfigured,
  protectedResourceMetadata
} from "@/web/runtime/mcp-resource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!mcpOAuthConfigured()) {
    return Response.json(
      { error: "mcp_oauth_not_configured" },
      {
        status: 503,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  return Response.json(
    protectedResourceMetadata(),
    {
      headers: {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*"
      }
    }
  );
}
