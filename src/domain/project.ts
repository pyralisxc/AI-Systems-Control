import type { IsoTimestamp, ProjectId } from "./shared.js";

export const PROJECT_STATUSES = ["active", "unavailable", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectReference {
  readonly kind: string;
  readonly value: string;
  readonly canonical?: boolean;
}

export interface Project {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly references: readonly ProjectReference[];
  readonly createdAt: IsoTimestamp;
  readonly status: ProjectStatus;
}
