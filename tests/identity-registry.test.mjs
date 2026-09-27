import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  assert.deepEqual(bootstrap.membership.roles, ["owner"]);

  const membership = bootstrap.registry.assertActiveMembership(
    bootstrap.principal.principalId,
    bootstrap.accountDomain.accountDomainId
  );
  assert.equal(membership.membershipId, bootstrap.membership.membershipId);
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
