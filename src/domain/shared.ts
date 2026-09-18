export type IsoTimestamp = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type ProjectId = string;
export type WorkspaceId = string;
export type CapabilityId = string;
export type CapabilityBindingId = string;
export type ActionId = string;
