import { createHash } from "node:crypto";

import type {
  AccountDomain,
  AccountDomainKind,
  AccountDomainStatus,
  AuthenticationIdentityBinding,
  AuthenticationIdentityPairing,
  AuthenticationIdentityPairingState,
  AuthenticationIdentityStatus,
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

export interface UpdateMembershipAuthorityInput {
  readonly membershipId: string;
  readonly roles?: readonly string[];
  readonly status?: MembershipStatus;
  readonly updatedAt?: string;
}

export interface RegisterAuthenticationIdentityInput {
  readonly bindingId?: string;
  readonly principalId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly label?: string;
  readonly status?: AuthenticationIdentityStatus;
  readonly createdAt?: string;
}

export interface ArmAuthenticationIdentityPairingInput {
  readonly pairingId?: string;
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly issuer: string;
  readonly expiresAt: string;
  readonly createdAt?: string;
}

export interface DetectAuthenticationIdentityCandidateInput {
  readonly issuer: string;
  readonly subject: string;
  readonly accountDomainId: string;
  readonly detectedAt?: string;
}

export interface ApproveAuthenticationIdentityPairingInput {
  readonly pairingId: string;
  readonly reviewedByPrincipalId: string;
  readonly approvedAt?: string;
}

export interface RevokeAuthenticationIdentityPairingInput {
  readonly pairingId: string;
  readonly reviewedByPrincipalId: string;
  readonly revokedAt?: string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + " cannot be empty.");
  return normalized;
}

function normalizedIssuer(value: string): string {
  const issuer = required(value, "Authentication issuer");
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error("Authentication issuer must be an absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Authentication issuer must use HTTPS.");
  }
  const serialized = url.toString();
  return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
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

function authenticationKey(issuer: string, subject: string): string {
  return normalizedIssuer(issuer) + "\u0000" + required(subject, "Authentication subject");
}

function generatedMembershipId(principalId: string, accountDomainId: string): string {
  const digest = createHash("sha256")
    .update(membershipKey(principalId, accountDomainId))
    .digest("hex")
    .slice(0, 24);
  return "membership:" + digest;
}

function generatedAuthenticationPairingId(
  principalId: string,
  accountDomainId: string,
  issuer: string,
  createdAt: string
): string {
  const digest = createHash("sha256")
    .update(
      principalId + "\u0000" +
      accountDomainId + "\u0000" +
      normalizedIssuer(issuer) + "\u0000" +
      createdAt
    )
    .digest("hex")
    .slice(0, 24);
  return "auth-pairing:" + digest;
}

function generatedAuthenticationBindingId(
  issuer: string,
  subject: string
): string {
  const digest = createHash("sha256")
    .update(authenticationKey(issuer, subject))
    .digest("hex")
    .slice(0, 24);
  return "auth-binding:" + digest;
}

function freezeMembership(membership: Membership): Membership {
  return Object.freeze({
    ...membership,
    generation:
      Number.isInteger(membership.generation) && membership.generation > 0
        ? membership.generation
        : 1,
    roles: Object.freeze([...membership.roles])
  });
}

function withoutMembershipRevokedAt(
  membership: Membership
): Membership {
  const { revokedAt: _revokedAt, ...rest } = membership;
  return rest;
}

function freezeAuthenticationBinding(
  binding: AuthenticationIdentityBinding
): AuthenticationIdentityBinding {
  return Object.freeze({ ...binding });
}

function freezeAuthenticationPairing(
  pairing: AuthenticationIdentityPairing
): AuthenticationIdentityPairing {
  return Object.freeze({ ...pairing });
}

function pairingExpired(
  pairing: AuthenticationIdentityPairing,
  now: string
): boolean {
  return Date.parse(pairing.expiresAt) <= Date.parse(now);
}

export class InMemoryIdentityRegistry {
  readonly #principals = new Map<string, Principal>();
  readonly #domains = new Map<string, AccountDomain>();
  readonly #memberships = new Map<string, Membership>();
  readonly #membershipByPair = new Map<string, string>();
  readonly #authenticationBindings = new Map<string, AuthenticationIdentityBinding>();
  readonly #authenticationByKey = new Map<string, string>();
  readonly #authenticationPairings = new Map<string, AuthenticationIdentityPairing>();

  constructor(input: {
    readonly principals?: readonly Principal[];
    readonly accountDomains?: readonly AccountDomain[];
    readonly memberships?: readonly Membership[];
    readonly authenticationBindings?: readonly AuthenticationIdentityBinding[];
    readonly authenticationPairings?: readonly AuthenticationIdentityPairing[];
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

    for (const binding of input.authenticationBindings ?? []) {
      this.#indexAuthenticationBinding(freezeAuthenticationBinding(binding));
    }

    for (const pairing of input.authenticationPairings ?? []) {
      if (this.#authenticationPairings.has(pairing.pairingId)) {
        throw new IdentityConflictError(
          "Duplicate authentication pairing: " + pairing.pairingId
        );
      }
      if (!this.#principals.has(pairing.principalId)) {
        throw new IdentityConflictError(
          "Authentication pairing references unknown Principal: " +
          pairing.principalId
        );
      }
      if (!this.#domains.has(pairing.accountDomainId)) {
        throw new IdentityConflictError(
          "Authentication pairing references unknown AccountDomain: " +
          pairing.accountDomainId
        );
      }
      this.#authenticationPairings.set(
        pairing.pairingId,
        freezeAuthenticationPairing(pairing)
      );
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

  #indexAuthenticationBinding(binding: AuthenticationIdentityBinding): void {
    if (!this.#principals.has(binding.principalId)) {
      throw new IdentityConflictError(
        "Authentication identity references unknown Principal: " +
        binding.principalId
      );
    }
    if (this.#authenticationBindings.has(binding.bindingId)) {
      throw new IdentityConflictError(
        "Duplicate authentication identity binding: " + binding.bindingId
      );
    }

    const key = authenticationKey(binding.issuer, binding.subject);
    const existing = this.#authenticationByKey.get(key);
    if (existing && existing !== binding.bindingId) {
      throw new IdentityConflictError(
        "Authentication identity is bound more than once: " + key
      );
    }

    this.#authenticationBindings.set(binding.bindingId, binding);
    this.#authenticationByKey.set(key, binding.bindingId);
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

  listAuthenticationBindings(): readonly AuthenticationIdentityBinding[] {
    return Object.freeze(
      [...this.#authenticationBindings.values()]
        .sort((left, right) => left.bindingId.localeCompare(right.bindingId))
    );
  }

  listAuthenticationPairings(
    accountDomainId?: string
  ): readonly AuthenticationIdentityPairing[] {
    return Object.freeze(
      [...this.#authenticationPairings.values()]
        .filter((pairing) =>
          accountDomainId
            ? pairing.accountDomainId === accountDomainId
            : true
        )
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.pairingId.localeCompare(right.pairingId)
        )
    );
  }

  getAuthenticationPairing(
    pairingId: string
  ): AuthenticationIdentityPairing | undefined {
    return this.#authenticationPairings.get(pairingId);
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

  getMembershipById(
    membershipId: string
  ): Membership | undefined {
    return this.#memberships.get(membershipId);
  }

  resolveAuthenticationIdentity(
    issuer: string,
    subject: string
  ): AuthenticationIdentityBinding | undefined {
    const bindingId = this.#authenticationByKey.get(
      authenticationKey(issuer, subject)
    );
    const binding = bindingId
      ? this.#authenticationBindings.get(bindingId)
      : undefined;
    return binding?.status === "active" ? binding : undefined;
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
      generation: 1,
      createdAt,
      updatedAt: createdAt
    });

    this.#indexMembership(membership);
    return membership;
  }

  updateMembershipAuthority(
    input: UpdateMembershipAuthorityInput
  ): Membership {
    const membershipId = required(
      input.membershipId,
      "Membership ID"
    );
    const existing = this.#memberships.get(membershipId);
    if (!existing) {
      throw new IdentityConflictError(
        "Unknown Membership: " + membershipId
      );
    }

    const roles = input.roles
      ? normalizedRoles(input.roles)
      : existing.roles;
    const status = input.status ?? existing.status;
    const changed =
      JSON.stringify(roles) !== JSON.stringify(existing.roles) ||
      status !== existing.status;
    if (!changed) return existing;

    const updatedAt =
      input.updatedAt ?? new Date().toISOString();
    const updated = freezeMembership({
      ...withoutMembershipRevokedAt(existing),
      roles,
      status,
      generation: existing.generation + 1,
      updatedAt,
      ...(status === "revoked"
        ? { revokedAt: updatedAt }
        : {})
    });
    this.#memberships.set(membershipId, updated);
    return updated;
  }

  armAuthenticationIdentityPairing(
    input: ArmAuthenticationIdentityPairingInput
  ): AuthenticationIdentityPairing {
    const principalId = required(input.principalId, "Principal ID");
    const accountDomainId = required(
      input.accountDomainId,
      "AccountDomain ID"
    );
    const issuer = normalizedIssuer(input.issuer);
    const createdAt = input.createdAt ?? new Date().toISOString();

    if (!Number.isFinite(Date.parse(input.expiresAt))) {
      throw new IdentityConflictError(
        "Authentication pairing expiry must be a valid timestamp."
      );
    }
    if (Date.parse(input.expiresAt) <= Date.parse(createdAt)) {
      throw new IdentityConflictError(
        "Authentication pairing expiry must be after creation."
      );
    }

    const principal = this.#principals.get(principalId);
    if (!principal || principal.status !== "active" || principal.kind !== "human") {
      throw new IdentityConflictError(
        "Authentication pairing requires an active human Principal."
      );
    }

    const membership = this.assertActiveMembership(
      principalId,
      accountDomainId
    );
    if (
      !membership.roles.includes("owner") &&
      !membership.roles.includes("admin")
    ) {
      throw new IdentityConflictError(
        "Authentication pairing requires owner/admin authority."
      );
    }

    const activeForIssuer = [...this.#authenticationPairings.values()]
      .filter((pairing) =>
        pairing.accountDomainId === accountDomainId &&
        pairing.issuer === issuer &&
        (pairing.state === "armed" ||
          pairing.state === "candidate_detected") &&
        !pairingExpired(pairing, createdAt)
      );

    const samePrincipal = activeForIssuer.find(
      (pairing) => pairing.principalId === principalId
    );
    if (samePrincipal) return samePrincipal;

    if (activeForIssuer.length > 0) {
      throw new IdentityConflictError(
        "Another authentication pairing is already active for this issuer and AccountDomain."
      );
    }

    const pairing = freezeAuthenticationPairing({
      pairingId:
        input.pairingId ??
        generatedAuthenticationPairingId(
          principalId,
          accountDomainId,
          issuer,
          createdAt
        ),
      principalId,
      accountDomainId,
      issuer,
      state: "armed",
      createdAt,
      updatedAt: createdAt,
      expiresAt: input.expiresAt
    });
    this.#authenticationPairings.set(pairing.pairingId, pairing);
    return pairing;
  }

  detectAuthenticationIdentityCandidate(
    input: DetectAuthenticationIdentityCandidateInput
  ): AuthenticationIdentityPairing | undefined {
    const issuer = normalizedIssuer(input.issuer);
    const subject = required(input.subject, "Authentication subject");
    const accountDomainId = required(
      input.accountDomainId,
      "AccountDomain ID"
    );
    const detectedAt = input.detectedAt ?? new Date().toISOString();

    const matching = [...this.#authenticationPairings.values()]
      .filter((pairing) =>
        pairing.accountDomainId === accountDomainId &&
        pairing.issuer === issuer &&
        (pairing.state === "armed" ||
          pairing.state === "candidate_detected") &&
        !pairingExpired(pairing, detectedAt)
      );

    if (matching.length === 0) return undefined;
    if (matching.length > 1) {
      throw new IdentityConflictError(
        "Authentication pairing is ambiguous for this issuer and AccountDomain."
      );
    }

    const pairing = matching[0]!;
    if (
      pairing.state === "candidate_detected" &&
      pairing.candidateSubject !== subject
    ) {
      throw new IdentityConflictError(
        "Authentication pairing already has a different detected identity."
      );
    }
    if (pairing.state === "candidate_detected") return pairing;

    const updated = freezeAuthenticationPairing({
      ...pairing,
      state: "candidate_detected",
      candidateSubject: subject,
      detectedAt,
      updatedAt: detectedAt
    });
    this.#authenticationPairings.set(pairing.pairingId, updated);
    return updated;
  }

  approveAuthenticationIdentityPairing(
    input: ApproveAuthenticationIdentityPairingInput
  ): {
    readonly pairing: AuthenticationIdentityPairing;
    readonly binding: AuthenticationIdentityBinding;
  } {
    const pairing = this.#authenticationPairings.get(
      required(input.pairingId, "Authentication pairing ID")
    );
    if (!pairing) {
      throw new IdentityConflictError(
        "Unknown authentication pairing."
      );
    }

    const approvedAt = input.approvedAt ?? new Date().toISOString();
    if (pairingExpired(pairing, approvedAt)) {
      throw new IdentityConflictError(
        "Authentication pairing has expired."
      );
    }
    if (
      pairing.state !== "candidate_detected" ||
      !pairing.candidateSubject
    ) {
      throw new IdentityConflictError(
        "Authentication pairing has no detected identity to approve."
      );
    }
    if (pairing.principalId !== input.reviewedByPrincipalId) {
      throw new IdentityConflictError(
        "Only the represented Principal may approve this authentication pairing."
      );
    }

    const principal = this.#principals.get(pairing.principalId);
    if (!principal || principal.status !== "active" || principal.kind !== "human") {
      throw new IdentityConflictError(
        "Authentication pairing Principal is not an active human."
      );
    }
    const membership = this.assertActiveMembership(
      pairing.principalId,
      pairing.accountDomainId
    );
    if (
      !membership.roles.includes("owner") &&
      !membership.roles.includes("admin")
    ) {
      throw new IdentityConflictError(
        "Authentication pairing approval requires owner/admin authority."
      );
    }

    const binding = this.registerAuthenticationIdentity({
      principalId: pairing.principalId,
      issuer: pairing.issuer,
      subject: pairing.candidateSubject,
      label: "Owner-approved identity pairing",
      createdAt: approvedAt
    });

    const consumed = freezeAuthenticationPairing({
      ...pairing,
      state: "consumed",
      consumedAt: approvedAt,
      updatedAt: approvedAt
    });
    this.#authenticationPairings.set(pairing.pairingId, consumed);

    return Object.freeze({
      pairing: consumed,
      binding
    });
  }

  revokeAuthenticationIdentityPairing(
    input: RevokeAuthenticationIdentityPairingInput
  ): AuthenticationIdentityPairing {
    const pairing = this.#authenticationPairings.get(
      required(input.pairingId, "Authentication pairing ID")
    );
    if (!pairing) {
      throw new IdentityConflictError(
        "Unknown authentication pairing."
      );
    }
    if (pairing.principalId !== input.reviewedByPrincipalId) {
      throw new IdentityConflictError(
        "Only the represented Principal may revoke this authentication pairing."
      );
    }
    if (pairing.state === "consumed" || pairing.state === "revoked") {
      return pairing;
    }

    const revokedAt = input.revokedAt ?? new Date().toISOString();
    const revoked = freezeAuthenticationPairing({
      ...pairing,
      state: "revoked",
      revokedAt,
      updatedAt: revokedAt
    });
    this.#authenticationPairings.set(pairing.pairingId, revoked);
    return revoked;
  }

  registerAuthenticationIdentity(
    input: RegisterAuthenticationIdentityInput
  ): AuthenticationIdentityBinding {
    const principalId = required(input.principalId, "Principal ID");
    if (!this.#principals.has(principalId)) {
      throw new IdentityConflictError(
        "Unknown Principal: " + principalId
      );
    }

    const issuer = normalizedIssuer(input.issuer);
    const subject = required(input.subject, "Authentication subject");
    const key = authenticationKey(issuer, subject);
    const existingId = this.#authenticationByKey.get(key);
    if (existingId) {
      const existing = this.#authenticationBindings.get(existingId)!;
      if (existing.principalId !== principalId) {
        throw new IdentityConflictError(
          "Authentication identity is already bound to Principal " +
          existing.principalId + "."
        );
      }
      return existing;
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const binding = freezeAuthenticationBinding({
      bindingId:
        input.bindingId ??
        generatedAuthenticationBindingId(issuer, subject),
      principalId,
      issuer,
      subject,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      status: input.status ?? "active",
      createdAt,
      updatedAt: createdAt
    });

    this.#indexAuthenticationBinding(binding);
    return binding;
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
