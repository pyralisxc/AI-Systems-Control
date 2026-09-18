import {
  evaluateDesiredVsObserved,
  evaluateObservationFreshness,
  type CapabilityBinding,
  type DesiredStateClaim,
  type DriftResult,
  type FreshnessPolicy,
  type Observation,
  type ObservationFreshness,
  type Project,
  type ReadCapability,
  type Workspace
} from "../domain/index.js";
import type { RealityProblem } from "../ports/index.js";
import type { SliceAComposition } from "./contracts.js";

export type SliceATruthCategory =
  | "observed"
  | "inferred"
  | "desired"
  | "proposed"
  | "reported"
  | "verified";

export interface OwnerProjectIdentity {
  readonly projectId: string;
  readonly name: string;
  readonly githubRepository?: string;
  readonly references: Project["references"];
}

export interface OwnerRealityItem {
  readonly truthCategory: "observed" | "inferred";
  readonly observation: Observation;
  readonly freshness: ObservationFreshness;
}

export interface OwnerDesiredItem {
  readonly truthCategory: "desired";
  readonly desired: DesiredStateClaim;
  readonly drift: DriftResult;
}

export interface OwnerCapabilityItem {
  readonly capability: ReadCapability;
  readonly bindings: readonly CapabilityBinding[];
}

export interface OwnerTruthSections {
  readonly observed: readonly OwnerRealityItem[];
  readonly inferred: readonly OwnerRealityItem[];
  readonly desired: readonly OwnerDesiredItem[];
  readonly proposed: readonly [];
  readonly reported: readonly [];
  readonly verified: readonly [];
}

export interface OwnerProjectRealityView {
  readonly project: OwnerProjectIdentity;
  readonly workspaceId: string;
  readonly realityAvailability: "available" | "partial" | "unavailable";
  readonly problems: readonly RealityProblem[];
  readonly truth: OwnerTruthSections;
  readonly capabilities: readonly OwnerCapabilityItem[];
}

export interface BuildOwnerProjectRealityViewInput {
  readonly composition: SliceAComposition;
  readonly project: Project;
  readonly workspace: Workspace;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly desiredState?: readonly DesiredStateClaim[];
  readonly evaluatedAt?: string;
}

function githubRepository(project: Project): string | undefined {
  return project.references.find((reference) => reference.kind === "github_repository")?.value;
}

function realityItem(
  observation: Observation,
  freshnessPolicy: FreshnessPolicy,
  evaluatedAt: string
): OwnerRealityItem {
  return Object.freeze({
    truthCategory: observation.quality === "derived" ? "inferred" : "observed",
    observation,
    freshness: evaluateObservationFreshness(observation, freshnessPolicy, evaluatedAt)
  });
}

export async function buildOwnerProjectRealityView(
  input: BuildOwnerProjectRealityViewInput
): Promise<OwnerProjectRealityView> {
  if (input.workspace.projectId !== input.project.projectId) {
    throw new Error(
      `Workspace ${input.workspace.workspaceId} belongs to project ${input.workspace.projectId}, not ${input.project.projectId}.`
    );
  }

  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const desired = input.desiredState ?? input.workspace.desiredStateOverlay ?? [];
  const github = githubRepository(input.project);

  const [reality, bindings] = await Promise.all([
    input.composition.realityProvider.observeProject({
      project: input.project,
      ...(input.workspace.selectedHost ? { host: input.workspace.selectedHost } : {})
    }),
    input.composition.bindingResolver.resolveReadBindings({
      project: input.project,
      workspace: input.workspace,
      capabilities: input.composition.capabilityCatalog.capabilities
    })
  ]);

  const drift = evaluateDesiredVsObserved({
    desired,
    observations: reality.observations,
    freshnessPolicy: input.freshnessPolicy,
    evaluatedAt
  });

  const realityItems = reality.observations.map((observation) =>
    realityItem(observation, input.freshnessPolicy, evaluatedAt)
  );
  const observed = realityItems.filter((item) => item.truthCategory === "observed");
  const inferred = realityItems.filter((item) => item.truthCategory === "inferred");

  const driftByDesired = new Map(
    drift.results.map((result) => [result.desired, result] as const)
  );
  const desiredItems = desired.map((claim) => {
    const result = driftByDesired.get(claim);
    if (!result) {
      throw new Error(
        `Drift evaluation did not return a result for desired state ${claim.scope}.${claim.key}.`
      );
    }
    return Object.freeze({
      truthCategory: "desired" as const,
      desired: claim,
      drift: result
    });
  });

  const capabilities = input.composition.capabilityCatalog.capabilities.map((capability) =>
    Object.freeze({
      capability,
      bindings: Object.freeze(
        bindings.filter((binding) => binding.capabilityId === capability.capabilityId)
      )
    })
  );

  return Object.freeze({
    project: Object.freeze({
      projectId: input.project.projectId,
      name: input.project.name,
      ...(github ? { githubRepository: github } : {}),
      references: input.project.references
    }),
    workspaceId: input.workspace.workspaceId,
    realityAvailability: reality.availability,
    problems: Object.freeze([...reality.problems]),
    truth: Object.freeze({
      observed: Object.freeze(observed),
      inferred: Object.freeze(inferred),
      desired: Object.freeze(desiredItems),
      proposed: Object.freeze([]) as readonly [],
      reported: Object.freeze([]) as readonly [],
      verified: Object.freeze([]) as readonly []
    }),
    capabilities: Object.freeze(capabilities)
  });
}
