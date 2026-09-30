import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IdentityConflictError,
  InMemoryIdentityRegistry,
  PersistentIdentityRegistry,
  bootstrapPersonalIdentity
} from "../dist/application/index.js";
import { JsonFileIdentityDirectoryStore } from "../dist/adapters/index.js";

test("personal mode is one human Principal with one owner Membership", () => {
  const bootstrap = bootstrapPersonalIdentity({
    principalId: "principal:cameron",
    principalDisplayName: "Cameron",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal",
    createdAt: "2026-09-27T17:30:00.000Z"
  });

  assert.equal(bootstrap.principal.kind, "human");
  assert.equal(bootstrap.accountDomain.kind, "personal");
  assert.equal(bootstrap.membership.status, "active");
  assert.equal(bootstrap.membership.generation, 1);
  assert.deepEqual(bootstrap.membership.roles, ["owner"]);

  const membership = bootstrap.registry.assertActiveMembership(
    bootstrap.principal.principalId,
    bootstrap.accountDomain.accountDomainId
  );
  assert.equal(membership.membershipId, bootstrap.membership.membershipId);
});

test("Membership authority changes increment generation and revoke immediately", () => {
  const bootstrap = bootstrapPersonalIdentity({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal"
  });
  const first = bootstrap.membership;
  const suspended =
    bootstrap.registry.updateMembershipAuthority({
      membershipId: first.membershipId,
      status: "suspended"
    });
  assert.equal(suspended.generation, 2);
  assert.equal(suspended.status, "suspended");
  assert.throws(
    () =>
      bootstrap.registry.assertActiveMembership(
        first.principalId,
        first.accountDomainId
      ),
    /no active Membership|not active/i
  );
  const restored =
    bootstrap.registry.updateMembershipAuthority({
      membershipId: first.membershipId,
      status: "active",
      roles: ["owner", "admin"]
    });
  assert.equal(restored.generation, 3);
  assert.deepEqual(restored.roles, ["admin", "owner"]);
});

test("organization domains support multiple human and service Principals", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerAccountDomain({
    accountDomainId: "domain:cardforge",
    kind: "organization",
    name: "CardForge"
  });

  registry.registerPrincipal({
    principalId: "principal:founder",
    kind: "human",
    displayName: "Founder"
  });
  registry.registerPrincipal({
    principalId: "principal:worker-service",
    kind: "service",
    displayName: "ASC Worker Service"
  });

  registry.registerMembership({
    principalId: "principal:founder",
    accountDomainId: "domain:cardforge",
    roles: ["owner"]
  });
  registry.registerMembership({
    principalId: "principal:worker-service",
    accountDomainId: "domain:cardforge",
    roles: ["operator"]
  });

  assert.equal(registry.listMemberships("domain:cardforge").length, 2);
  assert.equal(
    registry.getPrincipal("principal:worker-service")?.kind,
    "service"
  );
});

test("Membership cannot reference unknown Principal or AccountDomain", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerPrincipal({
    principalId: "principal:one",
    kind: "human",
    displayName: "One"
  });

  assert.throws(
    () => registry.registerMembership({
      principalId: "principal:one",
      accountDomainId: "domain:missing",
      roles: ["owner"]
    }),
    IdentityConflictError
  );
});

test("one Principal has at most one Membership per AccountDomain", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerPrincipal({
    principalId: "principal:one",
    kind: "human",
    displayName: "One"
  });
  registry.registerAccountDomain({
    accountDomainId: "domain:a",
    kind: "organization",
    name: "A"
  });

  const first = registry.registerMembership({
    principalId: "principal:one",
    accountDomainId: "domain:a",
    roles: ["admin"]
  });
  const second = registry.registerMembership({
    principalId: "principal:one",
    accountDomainId: "domain:a",
    roles: ["admin"]
  });

  assert.equal(first.membershipId, second.membershipId);
  assert.equal(registry.listMemberships("domain:a").length, 1);
});


test("persistent identity directory survives restart and enforces admin authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-identity-"));
  const path = join(directory, "identity.json");
  try {
    const identities = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    await identities.bootstrapPersonal({
      principalId: "principal:owner",
      principalDisplayName: "Owner",
      accountDomainId: "domain:personal",
      accountDomainName: "Personal"
    });

    const restarted = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    const membership = await restarted.assertPrincipalCanAdministerDomain(
      "principal:owner",
      "domain:personal"
    );
    assert.deepEqual(membership.roles, ["owner"]);

    await restarted.registerPrincipal({
      principalId: "principal:viewer",
      kind: "human",
      displayName: "Viewer"
    });
    await restarted.registerMembership({
      principalId: "principal:viewer",
      accountDomainId: "domain:personal",
      roles: ["viewer"]
    });
    await assert.rejects(
      () => restarted.assertPrincipalCanAdministerDomain(
        "principal:viewer",
        "domain:personal"
      ),
      /does not have owner\/admin authority/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("federated issuer plus subject resolves one stable Principal across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-identity-auth-"));
  const path = join(directory, "identity.json");
  try {
    const identities = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    await identities.bootstrapPersonal({
      principalId: "principal:owner",
      principalDisplayName: "Owner",
      accountDomainId: "domain:personal",
      accountDomainName: "Personal"
    });
    const binding = await identities.registerAuthenticationIdentity({
      principalId: "principal:owner",
      issuer: "https://login.example.test/",
      subject: "user-123",
      label: "Example IdP"
    });

    assert.equal(binding.issuer, "https://login.example.test");
    assert.equal(binding.subject, "user-123");

    const restarted = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    const resolved = await restarted.resolveAuthenticationIdentity(
      "https://login.example.test",
      "user-123"
    );
    assert.equal(resolved?.principalId, "principal:owner");
    assert.equal(resolved?.bindingId, binding.bindingId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same federated identity cannot be rebound to another Principal", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerPrincipal({
    principalId: "principal:one",
    kind: "human",
    displayName: "One"
  });
  registry.registerPrincipal({
    principalId: "principal:two",
    kind: "human",
    displayName: "Two"
  });

  registry.registerAuthenticationIdentity({
    principalId: "principal:one",
    issuer: "https://issuer.example.test",
    subject: "subject-a"
  });

  assert.throws(
    () => registry.registerAuthenticationIdentity({
      principalId: "principal:two",
      issuer: "https://issuer.example.test",
      subject: "subject-a"
    }),
    /already bound to Principal principal:one/i
  );
});

test("authentication issuer must be HTTPS and subject must be non-empty", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerPrincipal({
    principalId: "principal:one",
    kind: "human",
    displayName: "One"
  });

  assert.throws(
    () => registry.registerAuthenticationIdentity({
      principalId: "principal:one",
      issuer: "http://issuer.example.test",
      subject: "subject-a"
    }),
    /must use HTTPS/i
  );
  assert.throws(
    () => registry.registerAuthenticationIdentity({
      principalId: "principal:one",
      issuer: "https://issuer.example.test",
      subject: " "
    }),
    /subject cannot be empty/i
  );
});


test("Identity Directory v1 upgrades with no federated bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-identity-v1-"));
  const path = join(directory, "identity.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        revision: 4,
        principals: [{
          principalId: "principal:legacy",
          kind: "human",
          displayName: "Legacy",
          status: "active",
          createdAt: "2026-09-27T18:00:00.000Z",
          updatedAt: "2026-09-27T18:00:00.000Z"
        }],
        accountDomains: [{
          accountDomainId: "domain:legacy",
          kind: "personal",
          name: "Legacy",
          status: "active",
          createdAt: "2026-09-27T18:00:00.000Z",
          updatedAt: "2026-09-27T18:00:00.000Z"
        }],
        memberships: [{
          membershipId: "membership:legacy",
          principalId: "principal:legacy",
          accountDomainId: "domain:legacy",
          roles: ["owner"],
          status: "active",
          createdAt: "2026-09-27T18:00:00.000Z",
          updatedAt: "2026-09-27T18:00:00.000Z"
        }]
      }),
      "utf8"
    );

    const identities = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );

    assert.equal((await identities.listPrincipals()).length, 1);
    assert.equal((await identities.listAccountDomains()).length, 1);
    assert.deepEqual(await identities.listAuthenticationBindings(), []);
    assert.equal(
      (await identities.getMembership(
        "principal:legacy",
        "domain:legacy"
      ))?.generation,
      1
    );

    await identities.registerAuthenticationIdentity({
      principalId: "principal:legacy",
      issuer: "https://auth.example.test",
      subject: "legacy-subject"
    });

    const restarted = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    assert.equal(
      (await restarted.resolveAuthenticationIdentity(
        "https://auth.example.test",
        "legacy-subject"
      ))?.principalId,
      "principal:legacy"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("owner can arm pairing and detected identity remains unbound until approval", () => {
  const bootstrap = bootstrapPersonalIdentity({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal",
    createdAt: "2026-09-28T00:00:00.000Z"
  });
  const registry = bootstrap.registry;

  const pairing = registry.armAuthenticationIdentityPairing({
    principalId: "principal:owner",
    accountDomainId: "domain:personal",
    issuer: "https://auth.example.test",
    expiresAt: "2026-09-28T00:10:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z"
  });
  assert.equal(pairing.state, "armed");

  const detected = registry.detectAuthenticationIdentityCandidate({
    issuer: "https://auth.example.test",
    subject: "subject-123",
    accountDomainId: "domain:personal",
    detectedAt: "2026-09-28T00:01:00.000Z"
  });
  assert.equal(detected?.state, "candidate_detected");
  assert.equal(detected?.candidateSubject, "subject-123");
  assert.equal(
    registry.resolveAuthenticationIdentity(
      "https://auth.example.test",
      "subject-123"
    ),
    undefined
  );

  const approved = registry.approveAuthenticationIdentityPairing({
    pairingId: pairing.pairingId,
    reviewedByPrincipalId: "principal:owner",
    approvedAt: "2026-09-28T00:02:00.000Z"
  });
  assert.equal(approved.pairing.state, "consumed");
  assert.equal(approved.binding.principalId, "principal:owner");
  assert.equal(
    registry.resolveAuthenticationIdentity(
      "https://auth.example.test",
      "subject-123"
    )?.bindingId,
    approved.binding.bindingId
  );
});

test("unarmed token identity does not create pairing candidate state", () => {
  const bootstrap = bootstrapPersonalIdentity({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal"
  });

  const detected =
    bootstrap.registry.detectAuthenticationIdentityCandidate({
      issuer: "https://auth.example.test",
      subject: "subject-123",
      accountDomainId: "domain:personal"
    });

  assert.equal(detected, undefined);
  assert.deepEqual(
    bootstrap.registry.listAuthenticationPairings(),
    []
  );
});

test("only one active pairing per issuer and AccountDomain is allowed", () => {
  const registry = new InMemoryIdentityRegistry();
  registry.registerAccountDomain({
    accountDomainId: "domain:a",
    kind: "organization",
    name: "A"
  });
  for (const id of ["one", "two"]) {
    registry.registerPrincipal({
      principalId: "principal:" + id,
      kind: "human",
      displayName: id
    });
    registry.registerMembership({
      principalId: "principal:" + id,
      accountDomainId: "domain:a",
      roles: ["admin"]
    });
  }

  registry.armAuthenticationIdentityPairing({
    principalId: "principal:one",
    accountDomainId: "domain:a",
    issuer: "https://auth.example.test",
    expiresAt: "2026-09-28T00:10:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z"
  });

  assert.throws(
    () => registry.armAuthenticationIdentityPairing({
      principalId: "principal:two",
      accountDomainId: "domain:a",
      issuer: "https://auth.example.test",
      expiresAt: "2026-09-28T00:10:00.000Z",
      createdAt: "2026-09-28T00:01:00.000Z"
    }),
    /Another authentication pairing is already active/i
  );
});

test("expired pairing cannot detect or approve identity", () => {
  const bootstrap = bootstrapPersonalIdentity({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "domain:personal",
    accountDomainName: "Personal"
  });
  const registry = bootstrap.registry;
  const pairing = registry.armAuthenticationIdentityPairing({
    principalId: "principal:owner",
    accountDomainId: "domain:personal",
    issuer: "https://auth.example.test",
    expiresAt: "2026-09-28T00:01:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z"
  });

  assert.equal(
    registry.detectAuthenticationIdentityCandidate({
      issuer: "https://auth.example.test",
      subject: "subject-123",
      accountDomainId: "domain:personal",
      detectedAt: "2026-09-28T00:02:00.000Z"
    }),
    undefined
  );

  assert.throws(
    () => registry.approveAuthenticationIdentityPairing({
      pairingId: pairing.pairingId,
      reviewedByPrincipalId: "principal:owner",
      approvedAt: "2026-09-28T00:02:00.000Z"
    }),
    /expired|no detected identity/i
  );
});

test("pairing survives persistent identity-directory restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-identity-pairing-"));
  const path = join(directory, "identity.json");
  try {
    const identities = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    await identities.bootstrapPersonal({
      principalId: "principal:owner",
      principalDisplayName: "Owner",
      accountDomainId: "domain:personal",
      accountDomainName: "Personal"
    });
    const pairing = await identities.armAuthenticationIdentityPairing({
      principalId: "principal:owner",
      accountDomainId: "domain:personal",
      issuer: "https://auth.example.test",
      expiresAt: "2026-09-28T00:10:00.000Z",
      createdAt: "2026-09-28T00:00:00.000Z"
    });
    await identities.detectAuthenticationIdentityCandidate({
      issuer: "https://auth.example.test",
      subject: "subject-123",
      accountDomainId: "domain:personal",
      detectedAt: "2026-09-28T00:01:00.000Z"
    });

    const restarted = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    const persisted = await restarted.getAuthenticationPairing(
      pairing.pairingId
    );
    assert.equal(persisted?.state, "candidate_detected");
    assert.equal(persisted?.candidateSubject, "subject-123");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Identity Directory v2 upgrades with no pairing state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-identity-v2-"));
  const path = join(directory, "identity.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        revision: 5,
        principals: [],
        accountDomains: [],
        memberships: [],
        authenticationBindings: []
      }),
      "utf8"
    );

    const identities = new PersistentIdentityRegistry(
      new JsonFileIdentityDirectoryStore(path)
    );
    assert.deepEqual(
      await identities.listAuthenticationPairings(),
      []
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
