import type {
  CapabilityBinding,
  DriftResult,
  Project,
  Workspace
} from "../domain/index.js";
import type {
  ProjectRealityProvider,
  ProjectRealitySnapshot,
  ReadCapabilityBindingResolver
} from "../ports/index.js";
import type { SliceACapabilityCatalog } from "./read-capability-catalog.js";

export interface SliceAComposition {
  readonly realityProvider: ProjectRealityProvider;
  readonly bindingResolver: ReadCapabilityBindingResolver;
  readonly capabilityCatalog: SliceACapabilityCatalog;
}

export interface SliceAProjectRealityView {
  readonly project: Project;
  readonly workspace: Workspace;
  readonly reality: ProjectRealitySnapshot;
  readonly drift: readonly DriftResult[];
  readonly bindings: readonly CapabilityBinding[];
}
