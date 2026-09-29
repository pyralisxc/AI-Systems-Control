import { createHash, timingSafeEqual } from "node:crypto";

import type {
  DelegationUseReceipt,
  EffectClass
} from "../domain/index.js";
import {
  DelegationService
} from "./delegation-service.js";

export interface ConsumeAudienceDelegationInput {
  readonly handle: string;
  readonly projectId: string;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly workspaceId?: string;
  readonly environment?: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function serviceBearerMatches(
  authorizationHeader: string | null | undefined,
  expectedSecret: string
): boolean {
  const secret = expectedSecret.trim();
  if (secret.length < 32) return false;
  const prefix = "Bearer ";
  if (
    !authorizationHeader ||
    !authorizationHeader.startsWith(prefix)
  ) {
    return false;
  }
  const supplied = authorizationHeader.slice(prefix.length).trim();
  if (!supplied) return false;
  return timingSafeEqual(
    digest(supplied),
    digest(secret)
  );
}

export class DelegationAudienceBridge {
  readonly #delegations: DelegationService;
  readonly #audience: string;

  constructor(
    delegations: DelegationService,
    audience: string
  ) {
    const normalizedAudience = audience.trim();
    if (!normalizedAudience) {
      throw new Error("Delegation audience is required.");
    }
    this.#delegations = delegations;
    this.#audience = normalizedAudience;
  }

  consume(
    input: ConsumeAudienceDelegationInput
  ): Promise<DelegationUseReceipt> {
    return this.#delegations.consume(input.handle, {
      audience: this.#audience,
      projectId: input.projectId,
      capabilityId: input.capabilityId,
      effectClass: input.effectClass,
      ...(input.workspaceId
        ? { workspaceId: input.workspaceId }
        : {}),
      ...(input.environment
        ? { environment: input.environment }
        : {})
    });
  }
}
