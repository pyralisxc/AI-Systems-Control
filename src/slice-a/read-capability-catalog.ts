import {
  assertReadCapability,
  type Capability,
  type CapabilityId,
  type ReadCapability
} from "../domain/index.js";

export interface SliceACapabilityCatalog {
  readonly capabilities: readonly ReadCapability[];
  get(capabilityId: CapabilityId): ReadCapability | undefined;
}

export function createSliceACapabilityCatalog(
  capabilities: readonly Capability[]
): SliceACapabilityCatalog {
  for (const capability of capabilities) {
    assertReadCapability(capability);
  }

  const readCapabilities = capabilities as readonly ReadCapability[];
  const byId = new Map(readCapabilities.map((capability) => [capability.capabilityId, capability]));

  return Object.freeze({
    capabilities: Object.freeze([...readCapabilities]),
    get(capabilityId: CapabilityId): ReadCapability | undefined {
      return byId.get(capabilityId);
    }
  });
}
