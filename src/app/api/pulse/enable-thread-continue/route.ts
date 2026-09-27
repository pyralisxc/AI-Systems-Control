import { NextResponse } from "next/server";

import {
  ContinuationAuthorityError,
  ThreadContinueReviewError
} from "../../../../../dist/application/index.js";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  controlRegistryConfigured
} from "@/web/runtime/control-registry";
import {
  bridgedThreadServices
} from "@/web/runtime/thread-pulse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await isOwnerAuthenticated())) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 }
    );
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

  if (!threadId) {
    return NextResponse.json(
      { error: "thread_id_required" },
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
    await services.threadContinue.enableReadOnlyContinue({
      threadId,
      reviewedByPrincipalId: principalId
    });
  } catch (error) {
    if (
      error instanceof ThreadContinueReviewError ||
      error instanceof ContinuationAuthorityError
    ) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 403 }
      );
    }
    throw error;
  }

  return NextResponse.redirect(
    new URL("/pulse", request.url),
    303
  );
}
