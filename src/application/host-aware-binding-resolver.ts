import type {
  AvailabilityState,
  CapabilityBinding,
  PermissionState,
  Project,
  ReadCapability,
  Workspace
} from "../domain/index.js";
import type {
  ReadCapabilityBindingResolver,
  ResolveReadBindingsRequest
} from "../ports/index.js";

export interface ReadBindingCandidate {
  readonly bindingId: string;
  readonly capabilityId: string;
  readonly host: string;
  readonly provider: string;
  readonly adapter: string;
  readonly permissionState: PermissionState;
  readonly supported: boolean;
  readonly adapterAvailable: boolean;
  readonly reason?: string;
}

export interface ReadBindingCandidateRequest {
  readonly project: Project;
  readonly workspace?: Workspace;
  readonly capability: ReadCapability;
}

export interface ReadBindingCandidateSource {
  listCandidates(
    request: ReadBindingCandidateRequest
  ): Promise<readonly ReadBindingCandidate[]>;
}

function stableCandidateOrder(left: ReadBindingCandidate, right: ReadBindingCandidate): number {
  return (
    left.host.localeCompare(right.host) ||
    left.provider.localeCompare(right.provider) ||
    left.adapter.localeCompare(right.adapter) ||
    left.bindingId.localeCompare(right.bindingId)
  );
}

function binding(
  candidate: ReadBindingCandidate,
  project: Project,
  workspace: Workspace | undefined,
  availabilityState: AvailabilityState,
  reason?: string
): CapabilityBinding {
  return Object.freeze({
    bindingId: candidate.bindingId,
    capabilityId: candidate.capabilityId,
    projectId: project.projectId,
    ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
    host: candidate.host,
    provider: candidate.provider,
    adapter: candidate.adapter,
    permissionState: candidate.permissionState,
    availabilityState,
    ...(reason ? { reason } : {})
  });
}

function unavailableBinding(
  project: Project,
  workspace: Workspace | undefined,
  capability: ReadCapability,
  reason: string
): CapabilityBinding {
  const host = workspace?.selectedHost ?? "unresolved";
  return Object.freeze({
    bindingId: `unbound:${capability.capabilityId}:${host}`,
    capabilityId: capability.capabilityId,
    projectId: project.projectId,
    ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
    host,
    provider: "unbound",
    adapter: "unbound",
    permissionState: "unknown",
    availabilityState: "unavailable",
    reason
  });
}

function classifyCandidate(
  candidate: ReadBindingCandidate,
  project: Project,
  workspace: Workspace | undefined
): CapabilityBinding {
  if (!candidate.supported) {
    return binding(
      candidate,
      project,
      workspace,
      "unavailable",
      candidate.reason ?? `Capability is not supported on host ${candidate.host}.`
    );
  }

  if (!candidate.adapterAvailable) {
    return binding(
      candidate,
      project,
      workspace,
      "unavailable",
      candidate.reason ?? `Adapter ${candidate.adapter} is unavailable.`
    );
  }

  if (candidate.permissionState === "blocked") {
    return binding(
      candidate,
      project,
      workspace,
      "permission_blocked",
      candidate.reason ?? `Permission is blocked for provider ${candidate.provider}.`
    );
  }

  if (candidate.permissionState === "unknown") {
    return binding(
      candidate,
      project,
      workspace,
      "unavailable",
      candidate.reason ?? `Permission state is unknown for provider ${candidate.provider}.`
    );
  }

  return binding(candidate, project, workspace, "available");
}

function ambiguous(bindingValue: CapabilityBinding, count: number): CapabilityBinding {
  return Object.freeze({
    ...bindingValue,
    availabilityState: "ambiguous",
    reason: `${count} available bindings satisfy this capability; explicit binding selection is required.`
  });
}

export class HostAwareReadCapabilityBindingResolver implements ReadCapabilityBindingResolver {
  readonly #source: ReadBindingCandidateSource;

  constructor(source: ReadBindingCandidateSource) {
    this.#source = source;
  }

  async #resolveCapability(
    project: Project,
    workspace: Workspace | undefined,
    capability: ReadCapability
  ): Promise<readonly CapabilityBinding[]> {
    const candidates = [
      ...(await this.#source.listCandidates({
        project,
        ...(workspace ? { workspace } : {}),
        capability
      }))
    ]
      .filter((candidate) => candidate.capabilityId === capability.capabilityId)
      .sort(stableCandidateOrder);

    const selectedHost = workspace?.selectedHost;
    const hostCandidates = selectedHost
      ? candidates.filter((candidate) => candidate.host === selectedHost)
      : candidates;

    if (hostCandidates.length === 0) {
      return [
        unavailableBinding(
          project,
          workspace,
          capability,
          selectedHost
            ? `No binding for capability ${capability.capabilityId} supports selected host ${selectedHost}.`
            : `No binding candidates are available for capability ${capability.capabilityId}.`
        )
      ];
    }

    const classified = hostCandidates.map((candidate) =>
      classifyCandidate(candidate, project, workspace)
    );
    const available = classified.filter(
      (candidate) => candidate.availabilityState === "available"
    );

    if (available.length === 1) return Object.freeze(available);
    if (available.length > 1) {
      return Object.freeze(available.map((candidate) => ambiguous(candidate, available.length)));
    }

    const permissionBlocked = classified.filter(
      (candidate) => candidate.availabilityState === "permission_blocked"
    );
    if (permissionBlocked.length > 0) return Object.freeze(permissionBlocked);

    return Object.freeze(classified);
  }

  async resolveReadBindings(
    request: ResolveReadBindingsRequest
  ): Promise<readonly CapabilityBinding[]> {
    const groups = await Promise.all(
      request.capabilities.map((capability) =>
        this.#resolveCapability(request.project, request.workspace, capability)
      )
    );

    return Object.freeze(
      groups
        .flat()
        .sort(
          (left, right) =>
            left.capabilityId.localeCompare(right.capabilityId) ||
            left.host.localeCompare(right.host) ||
            left.provider.localeCompare(right.provider) ||
            left.adapter.localeCompare(right.adapter) ||
            left.bindingId.localeCompare(right.bindingId)
        )
    );
  }
}
