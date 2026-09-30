import type { EffectClass } from "./capability.js";
import type {
  AccountDomainId,
  IsoTimestamp,
  MembershipId,
  PrincipalId,
  ProjectId,
  ProjectMembershipId
} from "./shared.js";

export const PROJECT_MEMBERSHIP_STATUSES = [
  "active",
  "suspended",
  "revoked"
] as const;
export type ProjectMembershipStatus =
  (typeof PROJECT_MEMBERSHIP_STATUSES)[number];

export const BUILTIN_PROJECT_MEMBERSHIP_ROLES = [
  "project_admin",
  "operator",
  "viewer",
  "auditor"
] as const;
export type BuiltinProjectMembershipRole =
  (typeof BUILTIN_PROJECT_MEMBERSHIP_ROLES)[number];

export interface ProjectMembership {
  readonly projectMembershipId: ProjectMembershipId;
  readonly membershipId: MembershipId;
  readonly accountDomainId: AccountDomainId;
  readonly projectId: ProjectId;
  readonly roles: readonly string[];
  readonly status: ProjectMembershipStatus;
  readonly generation: number;
  readonly grantedByPrincipalId: PrincipalId;
  readonly updatedByPrincipalId: PrincipalId;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}

export function projectMembershipAllowsEffect(
  membership: ProjectMembership,
  effectClass: EffectClass
): boolean {
  if (membership.status !== "active") return false;
  const roles = new Set(membership.roles);
  if (effectClass === "read") {
    return (
      roles.has("project_admin") ||
      roles.has("operator") ||
      roles.has("viewer") ||
      roles.has("auditor")
    );
  }
  return (
    roles.has("project_admin") ||
    roles.has("operator")
  );
}
