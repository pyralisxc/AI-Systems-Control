export { createSliceACapabilityCatalog } from "./read-capability-catalog.js";
export type { SliceACapabilityCatalog } from "./read-capability-catalog.js";
export type { SliceAComposition, SliceAProjectRealityView } from "./contracts.js";

export type {
  CapabilityBinding,
  DesiredStateClaim,
  DriftResult,
  Observation,
  Project,
  ReadCapability,
  Workspace
} from "../domain/index.js";

export type {
  ProjectRealityProvider,
  ProjectRealitySnapshot,
  ReadCapabilityBindingResolver
} from "../ports/index.js";
