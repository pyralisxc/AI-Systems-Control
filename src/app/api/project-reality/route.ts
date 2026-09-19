import { NextRequest, NextResponse } from "next/server";
import { loadProjectWorkspace } from "@/web/runtime/project-workspace";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const repository = request.nextUrl.searchParams.get("repository")?.trim();
  if (!repository) {
    return NextResponse.json(
      { error: "repository query parameter is required" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  try {
    const view = await loadProjectWorkspace(repository);
    return NextResponse.json(view, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      {
        status: 400,
        headers: { "cache-control": "no-store" }
      }
    );
  }
}
