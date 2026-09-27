import { NextResponse } from "next/server";

import {
  ContinuationAuthorityError,
  OwnerAutonomyReviewError
} from "../../../../../../dist/application/index.js";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  controlRegistryConfigured
} from "@/web/runtime/control-registry";
import {
  bridgedThreadServices,
  relayCalibrationPolicy
} from "@/web/runtime/thread-pulse";

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

  if (!threadId || !relayId) {
    return NextResponse.json(
      { error: "thread_and_relay_required" },
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

  const snapshot = await services.store.load(threadId);
  const relay = snapshot?.relays.find(
    (candidate) => candidate.relayId === relayId
  );
  if (!snapshot || !relay) {
    return NextResponse.json(
      { error: "relay_not_found" },
      { status: 404 }
    );
  }

  try {
    await services.autonomyReview.grantContinueFromCalibration({
      representedPrincipalId: relay.representedPrincipalId,
      reviewedByPrincipalId: principalId,
      projectId: relay.projectId,
      workClass: relay.workClass,
      policy: relayCalibrationPolicy()
    });
  } catch (error) {
    if (
      error instanceof OwnerAutonomyReviewError ||
      error instanceof ContinuationAuthorityError
    ) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 403 }
      );
    }
    throw error;
  }

  return NextResponse.redirect(new URL("/pulse", request.url), 303);
}
