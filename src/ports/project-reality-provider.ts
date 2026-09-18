import type { Observation, Project, ProjectId } from "../domain/index.js";

export const REALITY_AVAILABILITY = ["available", "partial", "unavailable"] as const;
export type RealityAvailability = (typeof REALITY_AVAILABILITY)[number];

export interface ObserveProjectRequest {
  readonly project: Project;
  readonly host?: string;
}

export interface RealityProblem {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ProjectRealitySnapshot {
  readonly projectId: ProjectId;
  readonly availability: RealityAvailability;
  readonly observations: readonly Observation[];
  readonly problems: readonly RealityProblem[];
}

export interface ProjectRealityProvider {
  readonly providerId: string;
  observeProject(request: ObserveProjectRequest): Promise<ProjectRealitySnapshot>;
}
