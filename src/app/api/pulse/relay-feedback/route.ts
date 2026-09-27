import { NextResponse } from "next/server";

import { FounderRelayError } from "../../../../../dist/application/index.js";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  controlRegistryConfigured
} from "@/web/runtime/control-registry";
import { bridgedThreadServices } from "@/web/runtime/thread-pulse";

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
  const threadId =
    typeof form.get("threadId") === "string"
      ? String(form.get("threadId")).trim()
      : "";
  const relayId =
    typeof form.get("relayId") === "string"
      ? String(form.get("relayId")).trim()
      : "";
  const action =
    typeof form.get("action") === "string"
      ? String(form.get("action")).trim()
      : "";
  const editedText =
    typeof form.get("editedText") === "string"
      ? String(form.get("editedText"))
      : undefined;

  if (!threadId || !relayId) {
    return NextResponse.json(
      { error: "thread_and_relay_required" },
      { status: 400 }
    );
  }
  if (
    action !== "approve" &&
    action !== "edit" &&
    action !== "reject"
  ) {
    return NextResponse.json(
      { error: "unsupported_relay_action" },
      { status: 400 }
    );
  }

  if (action === "edit" && !editedText?.trim()) {
    return NextResponse.json(
      { error: "edited_text_required" },
      { status: 400 }
    );
  }

  const services = await bridgedThreadServices();
  const principalId = services.control.principalId;
  if (!principalId) {
    return NextResponse.json(
      { error: "principal_context_required" },
      { status: 503 }
    );
  }

  try {
    await services.relay.feedback({
      threadId,
      relayId,
      principalId,
      action,
      ...(action === "edit"
        ? { editedText: editedText!.trim() }
        : {})
    });
  } catch (error) {
    if (error instanceof FounderRelayError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 403 }
      );
    }
    throw error;
  }

  return NextResponse.redirect(new URL("/pulse", request.url), 303);
}
