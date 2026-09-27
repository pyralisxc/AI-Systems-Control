import {
  mcpOAuthConfigured
} from "@/web/runtime/mcp-resource";
import {
  serveAscMcp
} from "@/web/runtime/mcp-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request) {
  if (!mcpOAuthConfigured()) {
    return Response.json(
      { error: "mcp_oauth_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  return serveAscMcp(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}
