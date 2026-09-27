import assert from "node:assert/strict";
import test from "node:test";

import {
  IdentityConflictError,
  InMemoryIdentityRegistry,
  bootstrapPersonalIdentity
} from "../dist/application/index.js";

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
