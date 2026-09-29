import { NextResponse } from "next/server";

import {
  DelegationValidationError,
  serviceBearerMatches
} from "../../../../../../../dist/application/index.js";
import {
  isEffectClass
} from "../../../../../../../dist/domain/index.js";
import {
  consumeDevelopmentIntelligenceDelegation,
  developmentIntelligenceServiceBridgeConfigured,
  developmentIntelligenceServiceBridgeSecret
} from "@/web/runtime/development-intelligence-service-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function record(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requiredString(
  value: unknown,
  label: string,
  maxLength = 512
): string {
  if (typeof value !== "string") {
    throw new Error(label + " is required.");
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(label + " is invalid.");
  }
  return normalized;
}

function optionalString(
  value: unknown,
  label: string,
  maxLength = 512
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value, label, maxLength);
}

function parseBody(value: unknown) {
  if (!record(value)) {
    throw new Error("Delegation request body is invalid.");
  }

  const allowed = new Set([
    "accountDomainId",
    "handle",
    "projectId",
    "capabilityId",
    "effectClass",
    "workspaceId",
    "environment"
  ]);
  if (
    Object.keys(value).some(
      (key) => !allowed.has(key)
    )
  ) {
    throw new Error(
      "Delegation request contains unsupported fields."
    );
  }

  const handle = requiredString(
    value.handle,
    "Delegation handle",
    128
  );
  if (!/^ascd_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    throw new Error("Delegation handle is invalid.");
  }

  if (!isEffectClass(value.effectClass)) {
    throw new Error(
      "Delegation effect class is invalid."
    );
  }

  const workspaceId = optionalString(
    value.workspaceId,
    "Workspace",
    256
  );
  const environment = optionalString(
    value.environment,
    "Environment",
    128
  );

  return Object.freeze({
    accountDomainId: requiredString(
      value.accountDomainId,
      "AccountDomain",
      256
    ),
    handle,
    projectId: requiredString(
      value.projectId,
      "Project",
      256
    ),
    capabilityId: requiredString(
      value.capabilityId,
      "Capability",
      256
    ),
    effectClass: value.effectClass,
    ...(workspaceId ? { workspaceId } : {}),
    ...(environment ? { environment } : {})
  });
}

export async function POST(request: Request) {
  if (
    !developmentIntelligenceServiceBridgeConfigured()
  ) {
    return NextResponse.json(
      { error: "service_bridge_unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  const secret =
    developmentIntelligenceServiceBridgeSecret()!;
  if (
    !serviceBearerMatches(
      request.headers.get("authorization"),
      secret
    )
  ) {
    return NextResponse.json(
      { error: "unauthorized" },
      {
        status: 401,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  let input: ReturnType<typeof parseBody>;
  try {
    input = parseBody(await request.json());
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      {
        status: 400,
        headers: { "cache-control": "no-store" }
      }
    );
  }

  try {
    const receipt =
      await consumeDevelopmentIntelligenceDelegation(
        input
      );
    return NextResponse.json(
      { receipt },
      {
        status: 200,
        headers: { "cache-control": "no-store" }
      }
    );
  } catch (error) {
    if (error instanceof DelegationValidationError) {
      return NextResponse.json(
        { error: "delegation_rejected" },
        {
          status: 403,
          headers: { "cache-control": "no-store" }
        }
      );
    }

    return NextResponse.json(
      { error: "service_bridge_unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store" }
      }
    );
  }
}
