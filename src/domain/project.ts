import type {
  AccountDomainId,
  IsoTimestamp,
  ProjectId
} from "./shared.js";

export const PROJECT_STATUSES = ["active", "unavailable", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectReference {
  readonly kind: string;
  readonly value: string;
  readonly canonical?: boolean;
}

export interface Project {
  readonly projectId: ProjectId;
  readonly accountDomainId?: AccountDomainId;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly references: readonly ProjectReference[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt?: IsoTimestamp;
  readonly lastReconciledAt?: IsoTimestamp;
  readonly status: ProjectStatus;
}
