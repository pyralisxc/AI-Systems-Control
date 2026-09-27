import { createHash } from "node:crypto";

import type {
  AccountDomain,
  AccountDomainKind,
  AccountDomainStatus,
  Membership,
  MembershipStatus,
  Principal,
  PrincipalKind,
  PrincipalStatus
} from "../domain/index.js";

export class IdentityConflictError extends Error {
  readonly code = "identity_conflict";

  constructor(message: string) {
    super(message);
    this.name = "IdentityConflictError";
  }
}

export interface RegisterPrincipalInput {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
  readonly status?: PrincipalStatus;
  readonly createdAt?: string;
}

export interface RegisterAccountDomainInput {
  readonly accountDomainId: string;
  readonly kind: AccountDomainKind;
  readonly name: string;
  readonly status?: AccountDomainStatus;
  readonly createdAt?: string;
}

export interface RegisterMembershipInput {
  readonly membershipId?: string;
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly roles: readonly string[];
  readonly status?: MembershipStatus;
  readonly createdAt?: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + " cannot be empty.");
  return normalized;
}

function normalizedRoles(roles: readonly string[]): readonly string[] {
  const result = [...new Set(
    roles.map((role) => role.trim().toLowerCase()).filter(Boolean)
  )].sort();
  if (result.length === 0) {
    throw new Error("Membership must contain at least one role.");
  }
  return Object.freeze(result);
}

function membershipKey(principalId: string, accountDomainId: string): string {
  return principalId + "\u0000" + accountDomainId;
}

function generatedMembershipId(principalId: string, accountDomainId: string): string {
  const digest = createHash("sha256")
    .update(membershipKey(principalId, accountDomainId))
    .digest("hex")
    .slice(0, 24);
  return "membership:" + digest;
}

function freezeMembership(membership: Membership): Membership {
  return Object.freeze({
    ...membership,
    roles: Object.freeze([...membership.roles])
  });
}

export class InMemoryIdentityRegistry {
  readonly #principals = new Map<string, Principal>();
  readonly #domains = new Map<string, AccountDomain>();
  readonly #memberships = new Map<string, Membership>();
  readonly #membershipByPair = new Map<string, string>();

  constructor(input: {
    readonly principals?: readonly Principal[];
    readonly accountDomains?: readonly AccountDomain[];
    readonly memberships?: readonly Membership[];
  } = {}) {
    for (const principal of input.principals ?? []) {
      if (this.#principals.has(principal.principalId)) {
        throw new IdentityConflictError(
          "Duplicate Principal: " + principal.principalId
        );
      }
      this.#principals.set(principal.principalId, Object.freeze({ ...principal }));
    }

    for (const domain of input.accountDomains ?? []) {
      if (this.#domains.has(domain.accountDomainId)) {
        throw new IdentityConflictError(
          "Duplicate AccountDomain: " + domain.accountDomainId
        );
      }
      this.#domains.set(domain.accountDomainId, Object.freeze({ ...domain }));
    }

    for (const membership of input.memberships ?? []) {
      this.#indexMembership(freezeMembership(membership));
    }
  }

  #indexMembership(membership: Membership): void {
    if (!this.#principals.has(membership.principalId)) {
      throw new IdentityConflictError(
        "Membership references unknown Principal: " + membership.principalId
      );
    }
    if (!this.#domains.has(membership.accountDomainId)) {
      throw new IdentityConflictError(
        "Membership references unknown AccountDomain: " + membership.accountDomainId
      );
    }
    if (this.#memberships.has(membership.membershipId)) {
      throw new IdentityConflictError(
        "Duplicate Membership: " + membership.membershipId
      );
    }

    const pair = membershipKey(
      membership.principalId,
      membership.accountDomainId
    );
    const existing = this.#membershipByPair.get(pair);
    if (existing && existing !== membership.membershipId) {
      throw new IdentityConflictError(
        "Principal already has Membership " + existing +
        " in AccountDomain " + membership.accountDomainId + "."
      );
    }

    this.#memberships.set(membership.membershipId, membership);
    this.#membershipByPair.set(pair, membership.membershipId);
  }

  listPrincipals(): readonly Principal[] {
    return Object.freeze(
      [...this.#principals.values()]
        .sort((left, right) => left.principalId.localeCompare(right.principalId))
    );
  }

  listAccountDomains(): readonly AccountDomain[] {
    return Object.freeze(
      [...this.#domains.values()]
        .sort((left, right) =>
          left.accountDomainId.localeCompare(right.accountDomainId)
        )
    );
  }

  listMemberships(accountDomainId?: string): readonly Membership[] {
    return Object.freeze(
      [...this.#memberships.values()]
        .filter((membership) =>
          accountDomainId
            ? membership.accountDomainId === accountDomainId
            : true
        )
        .sort((left, right) =>
          left.membershipId.localeCompare(right.membershipId)
        )
    );
  }

  getPrincipal(principalId: string): Principal | undefined {
    return this.#principals.get(principalId);
  }

  getAccountDomain(accountDomainId: string): AccountDomain | undefined {
    return this.#domains.get(accountDomainId);
  }

  getMembership(
    principalId: string,
    accountDomainId: string
  ): Membership | undefined {
    const membershipId = this.#membershipByPair.get(
      membershipKey(principalId, accountDomainId)
    );
    return membershipId
      ? this.#memberships.get(membershipId)
      : undefined;
  }

  registerPrincipal(input: RegisterPrincipalInput): Principal {
    const principalId = required(input.principalId, "Principal ID");
    const existing = this.#principals.get(principalId);
    if (existing) {
      if (existing.kind !== input.kind) {
        throw new IdentityConflictError(
          "Principal " + principalId + " already exists as " + existing.kind + "."
        );
      }
      return existing;
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const principal = Object.freeze({
      principalId,
      kind: input.kind,
      displayName: required(input.displayName, "Principal display name"),
      status: input.status ?? "active",
      createdAt,
      updatedAt: createdAt
    });
    this.#principals.set(principalId, principal);
    return principal;
  }

  registerAccountDomain(input: RegisterAccountDomainInput): AccountDomain {
    const accountDomainId = required(
      input.accountDomainId,
      "AccountDomain ID"
    );
    const existing = this.#domains.get(accountDomainId);
    if (existing) {
      if (existing.kind !== input.kind) {
        throw new IdentityConflictError(
          "AccountDomain " + accountDomainId +
          " already exists as " + existing.kind + "."
        );
      }
      return existing;
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const domain = Object.freeze({
      accountDomainId,
      kind: input.kind,
      name: required(input.name, "AccountDomain name"),
      status: input.status ?? "active",
      createdAt,
      updatedAt: createdAt
    });
    this.#domains.set(accountDomainId, domain);
    return domain;
  }

  registerMembership(input: RegisterMembershipInput): Membership {
    const principalId = required(input.principalId, "Principal ID");
    const accountDomainId = required(
      input.accountDomainId,
      "AccountDomain ID"
    );

    if (!this.#principals.has(principalId)) {
      throw new IdentityConflictError(
        "Unknown Principal: " + principalId
      );
    }
    if (!this.#domains.has(accountDomainId)) {
      throw new IdentityConflictError(
        "Unknown AccountDomain: " + accountDomainId
      );
    }

    const existing = this.getMembership(principalId, accountDomainId);
    if (existing) {
      if (input.membershipId && existing.membershipId !== input.membershipId) {
        throw new IdentityConflictError(
          "Principal already has Membership " + existing.membershipId +
          " in AccountDomain " + accountDomainId + "."
        );
      }
      return existing;
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const membership = freezeMembership({
      membershipId:
        input.membershipId ??
        generatedMembershipId(principalId, accountDomainId),
      principalId,
      accountDomainId,
      roles: normalizedRoles(input.roles),
      status: input.status ?? "active",
      createdAt,
      updatedAt: createdAt
    });

    this.#indexMembership(membership);
    return membership;
  }

  assertActiveMembership(
    principalId: string,
    accountDomainId: string
  ): Membership {
    const principal = this.#principals.get(principalId);
    if (!principal || principal.status !== "active") {
      throw new IdentityConflictError(
        "Principal is not active: " + principalId
      );
    }

    const domain = this.#domains.get(accountDomainId);
    if (!domain || domain.status !== "active") {
      throw new IdentityConflictError(
        "AccountDomain is not active: " + accountDomainId
      );
    }

    const membership = this.getMembership(principalId, accountDomainId);
    if (!membership || membership.status !== "active") {
      throw new IdentityConflictError(
        "No active Membership for Principal " + principalId +
        " in AccountDomain " + accountDomainId + "."
      );
    }
    return membership;
  }
}

export function bootstrapPersonalIdentity(input: {
  readonly principalId: string;
  readonly principalDisplayName: string;
  readonly accountDomainId: string;
  readonly accountDomainName: string;
  readonly createdAt?: string;
}): {
  readonly registry: InMemoryIdentityRegistry;
  readonly principal: Principal;
  readonly accountDomain: AccountDomain;
  readonly membership: Membership;
} {
  const registry = new InMemoryIdentityRegistry();
  const principal = registry.registerPrincipal({
    principalId: input.principalId,
    kind: "human",
    displayName: input.principalDisplayName,
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  });
  const accountDomain = registry.registerAccountDomain({
    accountDomainId: input.accountDomainId,
    kind: "personal",
    name: input.accountDomainName,
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  });
  const membership = registry.registerMembership({
    principalId: principal.principalId,
    accountDomainId: accountDomain.accountDomainId,
    roles: ["owner"],
    ...(input.createdAt ? { createdAt: input.createdAt } : {})
  });

  return Object.freeze({
    registry,
    principal,
    accountDomain,
    membership
  });
}
