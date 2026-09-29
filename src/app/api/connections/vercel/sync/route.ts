import { NextResponse } from "next/server";

import {
  isOwnerAuthenticated
} from "@/web/auth/owner-auth";
import {
  refreshVercelConnections
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
    await refreshVercelConnections();
    return NextResponse.redirect(
      new URL(
        "/connections?connected=vercel",
        request.url
      ),
      303
    );
  } catch {
    return NextResponse.redirect(
      new URL(
        "/connections?vercelSync=error",
        request.url
      ),
      303
    );
  }
}
