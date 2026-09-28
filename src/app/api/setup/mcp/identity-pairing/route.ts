import { NextResponse } from "next/server";

import {
  IdentityConflictError
} from "../../../../../../dist/application/index.js";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  controlRegistryConfigured,
  defaultAccountDomainId,
  identityRegistryServices,
  resolvedPersonalPrincipalId
} from "@/web/runtime/control-registry";
import {
  mcpOAuthIssuer
} from "@/web/runtime/mcp-resource";

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
      { error: "durable_storage_required" },
      { status: 503 }
    );
  }

  const principalId = resolvedPersonalPrincipalId();
  if (!principalId) {
    return NextResponse.json(
      { error: "principal_context_required" },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const action =
    typeof form.get("action") === "string"
      ? String(form.get("action")).trim()
      : "";
  const pairingId =
    typeof form.get("pairingId") === "string"
      ? String(form.get("pairingId")).trim()
      : "";

  if (
    action !== "arm" &&
    action !== "approve" &&
    action !== "revoke"
  ) {
    return NextResponse.json(
      { error: "unsupported_pairing_action" },
      { status: 400 }
    );
  }

  let issuer: string;
  try {
    issuer = mcpOAuthIssuer();
  } catch {
    return NextResponse.json(
      { error: "oauth_issuer_required" },
      { status: 503 }
    );
  }

  const { identities } = await identityRegistryServices();
  const accountDomainId = defaultAccountDomainId();

  try {
    if (action === "arm") {
      const createdAt = new Date();
      const expiresAt = new Date(
        createdAt.getTime() + 10 * 60 * 1000
      );

      await identities.armAuthenticationIdentityPairing({
        principalId,
        accountDomainId,
        issuer,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString()
      });
    } else {
      if (!pairingId) {
        return NextResponse.json(
          { error: "pairing_id_required" },
          { status: 400 }
        );
      }

      if (action === "approve") {
        await identities.approveAuthenticationIdentityPairing({
          pairingId,
          reviewedByPrincipalId: principalId
        });
      } else {
        await identities.revokeAuthenticationIdentityPairing({
          pairingId,
          reviewedByPrincipalId: principalId
        });
      }
    }
  } catch (error) {
    if (error instanceof IdentityConflictError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: 403 }
      );
    }
    throw error;
  }

  return NextResponse.redirect(
    new URL("/setup/mcp", request.url),
    303
  );
}
