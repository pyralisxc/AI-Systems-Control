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
  const projectId =
    typeof form.get("projectId") === "string"
      ? String(form.get("projectId")).trim()
      : "";
  const repository =
    typeof form.get("repository") === "string"
      ? String(form.get("repository")).trim()
      : "";

  if (!projectId) {
    return NextResponse.json(
      { error: "project_id_required" },
      { status: 400 }
    );
  }

  const services = await controlRegistryServices();
  if (!services.principalId) {
    return NextResponse.json(
      { error: "principal_context_required" },
      { status: 503 }
    );
  }

  await services.authority.stopProject({
    projectId,
    changedByPrincipalId: services.principalId,
    reason: "owner web project stop"
  });

  const destination = repository
    ? "/?repository=" + encodeURIComponent(repository)
    : "/";
  return NextResponse.redirect(new URL(destination, request.url), 303);
}
