export type IsoTimestamp = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type PrincipalId = string;
export type MembershipId = string;
export type ProjectMembershipId = string;
export type AccountDomainId = string;
export type ProjectId = string;
export type WorkspaceId = string;
export type ConnectionId = string;
export type CapabilityId = string;
export type CapabilityBindingId = string;
export type ActionId = string;
