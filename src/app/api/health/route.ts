import { NextResponse } from "next/server";
import { ownerAuthConfigured } from "@/web/auth/owner-auth";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      service: "AI Systems Control",
      version: "0.2.0",
      status: "ok",
      ownerAuthConfigured: ownerAuthConfigured(),
      developmentIntelligenceConfigured: Boolean(process.env.DEVINT_URL?.trim()),
      mutationSurface: "disabled",
      observedAt: new Date().toISOString()
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
