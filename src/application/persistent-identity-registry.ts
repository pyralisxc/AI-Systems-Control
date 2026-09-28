import {
  IdentityConflictError,
  InMemoryIdentityRegistry,
  type ApproveAuthenticationIdentityPairingInput,
  type ArmAuthenticationIdentityPairingInput,
  type DetectAuthenticationIdentityCandidateInput,
  type RegisterAccountDomainInput,
  type RegisterAuthenticationIdentityInput,
  type RegisterMembershipInput,
  type RegisterPrincipalInput,
  type RevokeAuthenticationIdentityPairingInput
} from "./identity-registry.js";
import type {
  AccountDomain,
  AuthenticationIdentityBinding,
  AuthenticationIdentityPairing,
  Membership,
  Principal
} from "../domain/index.js";
import {
  IdentityDirectoryRevisionConflictError,
  type IdentityDirectorySnapshot,
  type IdentityDirectoryStore
} from "../ports/index.js";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

interface IdentityMutationResult<T> {
  readonly result: T;
  readonly principals: readonly Principal[];
  readonly accountDomains: readonly AccountDomain[];
  readonly memberships: readonly Membership[];
  readonly authenticationBindings: readonly AuthenticationIdentityBinding[];
  readonly authenticationPairings: readonly AuthenticationIdentityPairing[];
  readonly changed: boolean;
}

async function mutateIdentityDirectory<T>(
  store: IdentityDirectoryStore,
  mutate: (snapshot: IdentityDirectorySnapshot) => IdentityMutationResult<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await store.load();
    const mutation = mutate(snapshot);
    if (!mutation.changed) return mutation.result;

    try {
      await store.save({
        expectedRevision: snapshot.revision,
        principals: mutation.principals,
        accountDomains: mutation.accountDomains,
        memberships: mutation.memberships,
        authenticationBindings: mutation.authenticationBindings,
        authenticationPairings: mutation.authenticationPairings,
        updatedAt: new Date().toISOString()
      });
      return mutation.result;
    } catch (error) {
      if (
        !(error instanceof IdentityDirectoryRevisionConflictError) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }
  throw new Error("Identity directory mutation exhausted retry budget.");
}

function registryFrom(snapshot: IdentityDirectorySnapshot) {
  return new InMemoryIdentityRegistry({
    principals: snapshot.principals,
    accountDomains: snapshot.accountDomains,
    memberships: snapshot.memberships,
    authenticationBindings: snapshot.authenticationBindings,
    authenticationPairings: snapshot.authenticationPairings
  });
}

function mutationResult<T>(
  snapshot: IdentityDirectorySnapshot,
  registry: InMemoryIdentityRegistry,
  result: T
): IdentityMutationResult<T> {
  const principals = registry.listPrincipals();
  const accountDomains = registry.listAccountDomains();
  const memberships = registry.listMemberships();
  const authenticationBindings = registry.listAuthenticationBindings();
  const authenticationPairings = registry.listAuthenticationPairings();
  const before = stableJson({
    principals: snapshot.principals,
    accountDomains: snapshot.accountDomains,
    memberships: snapshot.memberships,
    authenticationBindings: snapshot.authenticationBindings,
    authenticationPairings: snapshot.authenticationPairings
  });
  const after = stableJson({
    principals,
    accountDomains,
    memberships,
    authenticationBindings,
    authenticationPairings
  });

  return {
    result,
    principals,
    accountDomains,
    memberships,
    authenticationBindings,
    authenticationPairings,
    changed: before !== after
  };
}

export class PersistentIdentityRegistry {
  readonly #store: IdentityDirectoryStore;

  constructor(store: IdentityDirectoryStore) {
    this.#store = store;
  }

  async listPrincipals(): Promise<readonly Principal[]> {
    return registryFrom(await this.#store.load()).listPrincipals();
  }

  async getPrincipal(principalId: string): Promise<Principal | undefined> {
    return registryFrom(await this.#store.load()).getPrincipal(principalId);
  }

  async getMembership(
    principalId: string,
    accountDomainId: string
  ): Promise<Membership | undefined> {
    return registryFrom(await this.#store.load()).getMembership(
      principalId,
      accountDomainId
    );
  }

  async listAuthenticationBindings(): Promise<
    readonly AuthenticationIdentityBinding[]
  > {
    return registryFrom(await this.#store.load())
      .listAuthenticationBindings();
  }

  async resolveAuthenticationIdentity(
    issuer: string,
    subject: string
  ): Promise<AuthenticationIdentityBinding | undefined> {
    return registryFrom(await this.#store.load())
      .resolveAuthenticationIdentity(issuer, subject);
  }

  async listAuthenticationPairings(
    accountDomainId?: string
  ): Promise<readonly AuthenticationIdentityPairing[]> {
    return registryFrom(await this.#store.load())
      .listAuthenticationPairings(accountDomainId);
  }

  async getAuthenticationPairing(
    pairingId: string
  ): Promise<AuthenticationIdentityPairing | undefined> {
    return registryFrom(await this.#store.load())
      .getAuthenticationPairing(pairingId);
  }

  async listAccountDomains(): Promise<readonly AccountDomain[]> {
    return registryFrom(await this.#store.load()).listAccountDomains();
  }

  async listMemberships(
    accountDomainId?: string
  ): Promise<readonly Membership[]> {
    return registryFrom(await this.#store.load())
      .listMemberships(accountDomainId);
  }

  async registerPrincipal(
    input: RegisterPrincipalInput
  ): Promise<Principal> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.registerPrincipal(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async registerAccountDomain(
    input: RegisterAccountDomainInput
  ): Promise<AccountDomain> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.registerAccountDomain(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async armAuthenticationIdentityPairing(
    input: ArmAuthenticationIdentityPairingInput
  ): Promise<AuthenticationIdentityPairing> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.armAuthenticationIdentityPairing(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async detectAuthenticationIdentityCandidate(
    input: DetectAuthenticationIdentityCandidateInput
  ): Promise<AuthenticationIdentityPairing | undefined> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.detectAuthenticationIdentityCandidate(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async approveAuthenticationIdentityPairing(
    input: ApproveAuthenticationIdentityPairingInput
  ): Promise<{
    readonly pairing: AuthenticationIdentityPairing;
    readonly binding: AuthenticationIdentityBinding;
  }> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.approveAuthenticationIdentityPairing(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async revokeAuthenticationIdentityPairing(
    input: RevokeAuthenticationIdentityPairingInput
  ): Promise<AuthenticationIdentityPairing> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.revokeAuthenticationIdentityPairing(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async registerAuthenticationIdentity(
    input: RegisterAuthenticationIdentityInput
  ): Promise<AuthenticationIdentityBinding> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.registerAuthenticationIdentity(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async registerMembership(
    input: RegisterMembershipInput
  ): Promise<Membership> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
      const result = registry.registerMembership(input);
      return mutationResult(snapshot, registry, result);
    });
  }

  async bootstrapPersonal(input: {
    readonly principalId: string;
    readonly principalDisplayName: string;
    readonly accountDomainId: string;
    readonly accountDomainName: string;
    readonly createdAt?: string;
  }): Promise<{
    readonly principal: Principal;
    readonly accountDomain: AccountDomain;
    readonly membership: Membership;
  }> {
    return mutateIdentityDirectory(this.#store, (snapshot) => {
      const registry = registryFrom(snapshot);
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

      return mutationResult(snapshot, registry, Object.freeze({
        principal,
        accountDomain,
        membership
      }));
    });
  }

  async assertActiveMembership(
    principalId: string,
    accountDomainId: string
  ): Promise<Membership> {
    return registryFrom(await this.#store.load()).assertActiveMembership(
      principalId,
      accountDomainId
    );
  }

  async assertActiveDomain(accountDomainId: string): Promise<AccountDomain> {
    const registry = registryFrom(await this.#store.load());
    const domain = registry.getAccountDomain(accountDomainId);
    if (!domain || domain.status !== "active") {
      throw new IdentityConflictError(
        "AccountDomain is not active: " + accountDomainId
      );
    }
    return domain;
  }

  async assertPrincipalCanAdministerDomain(
    principalId: string,
    accountDomainId: string
  ): Promise<Membership> {
    const registry = registryFrom(await this.#store.load());
    const membership = registry.assertActiveMembership(
      principalId,
      accountDomainId
    );
    if (
      !membership.roles.includes("owner") &&
      !membership.roles.includes("admin")
    ) {
      throw new IdentityConflictError(
        "Principal " + principalId +
        " does not have owner/admin authority in AccountDomain " +
        accountDomainId + "."
      );
    }
    return membership;
  }
}
