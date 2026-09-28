import { NextResponse } from "next/server";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  beginGitHubConnection
} from "@/web/runtime/provider-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
  }

  try {
    const begun = await beginGitHubConnection();
    return NextResponse.redirect(
      new URL(begun.authorizationUrl),
      303
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "github_connection_unavailable",
        message:
          error instanceof Error
            ? error.message
            : "GitHub Connection is unavailable."
      },
      { status: 503 }
    );
  }
}
