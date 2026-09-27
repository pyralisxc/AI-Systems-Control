import type {
  AccountDomainId,
  IsoTimestamp,
  MembershipId,
  PrincipalId
} from "./shared.js";

export const PRINCIPAL_KINDS = ["human", "service"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const PRINCIPAL_STATUSES = ["active", "suspended"] as const;
export type PrincipalStatus = (typeof PRINCIPAL_STATUSES)[number];

export interface Principal {
  readonly principalId: PrincipalId;
  readonly kind: PrincipalKind;
  readonly displayName: string;
  readonly status: PrincipalStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export const ACCOUNT_DOMAIN_KINDS = ["personal", "organization"] as const;
export type AccountDomainKind = (typeof ACCOUNT_DOMAIN_KINDS)[number];

export const ACCOUNT_DOMAIN_STATUSES = ["active", "suspended", "archived"] as const;
export type AccountDomainStatus = (typeof ACCOUNT_DOMAIN_STATUSES)[number];

export interface AccountDomain {
  readonly accountDomainId: AccountDomainId;
  readonly kind: AccountDomainKind;
  readonly name: string;
  readonly status: AccountDomainStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export const MEMBERSHIP_STATUSES = ["active", "invited", "suspended", "revoked"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const BUILTIN_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer",
  "auditor"
] as const;
export type BuiltinMembershipRole = (typeof BUILTIN_MEMBERSHIP_ROLES)[number];

export interface Membership {
  readonly membershipId: MembershipId;
  readonly principalId: PrincipalId;
  readonly accountDomainId: AccountDomainId;
  readonly roles: readonly string[];
  readonly status: MembershipStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}

export const AUTHENTICATION_IDENTITY_STATUSES = ["active", "revoked"] as const;
export type AuthenticationIdentityStatus =
  (typeof AUTHENTICATION_IDENTITY_STATUSES)[number];

export interface AuthenticationIdentityBinding {
  readonly bindingId: string;
  readonly principalId: PrincipalId;
  readonly issuer: string;
  readonly subject: string;
  readonly label?: string;
  readonly status: AuthenticationIdentityStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}

export function membershipHasRole(
  membership: Membership,
  role: string
): boolean {
  return membership.status === "active" && membership.roles.includes(role);
}
