import { NextResponse } from "next/server";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  controlRegistryConfigured,
  controlRegistryServices
} from "@/web/runtime/control-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!controlRegistryConfigured()) {
    return NextResponse.json(
      { error: "control_registry_not_configured" },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const connectionId =
    typeof form.get("connectionId") === "string"
      ? String(form.get("connectionId")).trim()
      : "";

  if (!connectionId) {
    return NextResponse.json({ error: "connection_id_required" }, { status: 400 });
  }

  const services = await controlRegistryServices();
  await services.connections.assertPrincipalCanAdminister(
    services.principalId
  );
  await services.connections.setStatus(connectionId, "revoked");

  return NextResponse.redirect(new URL("/connections", request.url), 303);
}
