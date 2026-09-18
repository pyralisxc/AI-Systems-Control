import type {
  CapabilityBindingId,
  CapabilityId,
  JsonValue,
  ProjectId,
  WorkspaceId
} from "./shared.js";

export const EFFECT_CLASSES = ["read", "propose", "mutate"] as const;
export type EffectClass = (typeof EFFECT_CLASSES)[number];

export const RISK_CLASSES = ["none", "low", "medium", "high"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const PERMISSION_STATES = [
  "granted",
  "blocked",
  "unknown",
  "not_required"
] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

export const AVAILABILITY_STATES = [
  "available",
  "unavailable",
  "permission_blocked",
  "ambiguous"
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

export interface CapabilitySchema {
  readonly type: string;
  readonly properties?: Readonly<Record<string, JsonValue>>;
  readonly required?: readonly string[];
}

export interface Capability<E extends EffectClass = EffectClass> {
  readonly capabilityId: CapabilityId;
  readonly name: string;
  readonly inputSchema: CapabilitySchema;
  readonly outputSchema: CapabilitySchema;
  readonly effectClass: E;
  readonly riskClass: RiskClass;
  readonly ownerSystem: string;
}

export type ReadCapability = Capability<"read">;

export interface CapabilityBinding {
  readonly bindingId: CapabilityBindingId;
  readonly capabilityId: CapabilityId;
  readonly projectId: ProjectId;
  readonly workspaceId?: WorkspaceId;
  readonly host: string;
  readonly provider: string;
  readonly adapter: string;
  readonly permissionState: PermissionState;
  readonly availabilityState: AvailabilityState;
  readonly reason?: string;
}

export function isEffectClass(value: unknown): value is EffectClass {
  return typeof value === "string" && EFFECT_CLASSES.includes(value as EffectClass);
}

export function isReadCapability(capability: Capability): capability is ReadCapability {
  return capability.effectClass === "read";
}

export function assertReadCapability(
  capability: Capability
): asserts capability is ReadCapability {
  if (!isReadCapability(capability)) {
    throw new Error(
      `Slice A accepts only read capabilities; ${capability.capabilityId} is ${capability.effectClass}.`
    );
  }
}
