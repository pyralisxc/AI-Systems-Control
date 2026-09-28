import { NextResponse } from "next/server";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  completeGitHubConnection
} from "@/web/runtime/provider-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.redirect(
      new URL(
        "/login?returnTo=" +
        encodeURIComponent(
          new URL(request.url).pathname +
          new URL(request.url).search
        ),
        request.url
      ),
      303
    );
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!state) {
    return NextResponse.json(
      { error: "github_state_required" },
      { status: 400 }
    );
  }

  const callback: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "state") continue;
    callback[key] = value;
  }

  try {
    await completeGitHubConnection(
      state,
      Object.freeze(callback)
    );

    return NextResponse.redirect(
      new URL("/connections?connected=github", request.url),
      303
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "github_connection_failed",
        message:
          error instanceof Error
            ? error.message
            : "GitHub Connection failed."
      },
      { status: 403 }
    );
  }
}
