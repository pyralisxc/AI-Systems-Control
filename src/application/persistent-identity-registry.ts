import {
  IdentityConflictError,
  InMemoryIdentityRegistry,
  type RegisterAccountDomainInput,
  type RegisterMembershipInput,
  type RegisterPrincipalInput
} from "./identity-registry.js";
import type {
  AccountDomain,
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
    memberships: snapshot.memberships
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
  const before = stableJson({
    principals: snapshot.principals,
    accountDomains: snapshot.accountDomains,
    memberships: snapshot.memberships
  });
  const after = stableJson({ principals, accountDomains, memberships });

  return {
    result,
    principals,
    accountDomains,
    memberships,
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
