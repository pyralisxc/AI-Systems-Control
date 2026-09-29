import type {
  DelegationUseReceipt,
  EffectClass
} from "../../../dist/domain/index.js";
import {
  DelegationAudienceBridge
} from "../../../dist/application/index.js";
import {
  controlRegistryServicesForDomain
} from "./control-registry";

export interface DevelopmentIntelligenceDelegationConsumeInput {
  readonly accountDomainId: string;
  readonly handle: string;
  readonly projectId: string;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly workspaceId?: string;
  readonly environment?: string;
}

export function developmentIntelligenceServiceBridgeSecret():
  | string
  | undefined {
  return (
    process.env
      .ASC_DEVELOPMENT_INTELLIGENCE_SERVICE_BRIDGE_SECRET
      ?.trim() || undefined
  );
}

export function developmentIntelligenceServiceBridgeConfigured(): boolean {
  const secret =
    developmentIntelligenceServiceBridgeSecret();
  return Boolean(secret && secret.length >= 32);
}

export async function consumeDevelopmentIntelligenceDelegation(
  input: DevelopmentIntelligenceDelegationConsumeInput
): Promise<DelegationUseReceipt> {
  const services =
    await controlRegistryServicesForDomain(
      input.accountDomainId
    );
  const bridge = new DelegationAudienceBridge(
    services.delegations,
    "development-intelligence"
  );

  return bridge.consume({
    handle: input.handle,
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
