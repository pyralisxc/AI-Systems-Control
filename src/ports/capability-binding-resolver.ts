import type {
  CapabilityBinding,
  Project,
  ReadCapability,
  Workspace
} from "../domain/index.js";

export interface ResolveReadBindingsRequest {
  readonly project: Project;
  readonly workspace: Workspace;
  readonly capabilities: readonly ReadCapability[];
}

export interface ReadCapabilityBindingResolver {
  resolveReadBindings(
    request: ResolveReadBindingsRequest
  ): Promise<readonly CapabilityBinding[]>;
}
