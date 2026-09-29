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

export interface ConductorDelegationConsumeInput {
  readonly accountDomainId: string;
  readonly handle: string;
  readonly projectId: string;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly workspaceId?: string;
  readonly environment?: string;
}

export function conductorServiceBridgeSecret():
  | string
  | undefined {
  const preferred =
    process.env.ASC_CONDUCTOR_SERVICE_BRIDGE_SECRET?.trim();
  if (preferred) return preferred;

  // Compatibility alias used by the initial provider-attestation bridge.
  const legacy =
    process.env.ASC_CONDUCTOR_PROVIDER_BRIDGE_SECRET?.trim();
  return legacy || undefined;
}

export function conductorServiceBridgeConfigured(): boolean {
  const secret = conductorServiceBridgeSecret();
  return Boolean(secret && secret.length >= 32);
}

export async function consumeConductorDelegation(
  input: ConductorDelegationConsumeInput
): Promise<DelegationUseReceipt> {
  const services =
    await controlRegistryServicesForDomain(
      input.accountDomainId
    );
  const bridge = new DelegationAudienceBridge(
    services.delegations,
    "conductor"
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
