import { NextResponse } from "next/server";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  bindGitHubConnectionToProject
} from "@/web/runtime/provider-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formString(
  form: FormData,
  name: string
): string {
  const value = form.get(name);
  return typeof value === "string"
    ? value.trim()
    : "";
}

export async function POST(request: Request) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
  }

  const form = await request.formData();
  const projectId = formString(form, "projectId");
  const connectionId =
    formString(form, "connectionId");
  const executionCapability =
    formString(form, "executionCapability");

  if (
    !projectId ||
    !connectionId ||
    !executionCapability
  ) {
    return NextResponse.json(
      { error: "binding_input_required" },
      { status: 400 }
    );
  }

  try {
    await bindGitHubConnectionToProject({
      projectId,
      connectionId,
      executionCapability
    });
    return NextResponse.redirect(
      new URL(
        "/connections?githubBinding=connected",
        request.url
      ),
      303
    );
  } catch {
    return NextResponse.redirect(
      new URL(
        "/connections?githubBinding=error",
        request.url
      ),
      303
    );
  }
}
