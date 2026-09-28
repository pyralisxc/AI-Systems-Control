import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  McpRequestIdentityResolver,
  PersistentIdentityRegistry
} from "../dist/application/index.js";
import {
  McpAuthenticationError
} from "../dist/ports/index.js";
import {
  JsonFileIdentityDirectoryStore
} from "../dist/adapters/index.js";

class FakeVerifier {
  value;

  constructor(value) {
    this.value = value;
  }

  async verify() {
    return this.value;
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "asc-mcp-auth-"));
  const identities = new PersistentIdentityRegistry(
    new JsonFileIdentityDirectoryStore(join(directory, "identity.json"))
  );
  await identities.bootstrapPersonal({
    principalId: "principal:owner",
    principalDisplayName: "Owner",
    accountDomainId: "business-a",
    accountDomainName: "Business A"
  });
  await identities.registerAuthenticationIdentity({
    principalId: "principal:owner",
    issuer: "https://auth.example.test",
    subject: "user-123"
  });

  return { directory, identities };
}

function verified(overrides = {}) {
  return {
    issuer: "https://auth.example.test",
    subject: "user-123",
    accountDomainId: "business-a",
    audience: ["https://asc.example.test"],
    scopes: ["asc.thread.read", "asc.thread.write"],
    expiresAt: 1790542800,
    ...overrides
  };
}

test("verified external identity resolves exact Principal and Membership", async () => {
  const context = await setup();
  try {
    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(verified()),
      identities: context.identities
    });

    const caller = await resolver.resolve("token-value", [
      "asc.thread.read"
    ]);

    assert.equal(caller.principalId, "principal:owner");
    assert.equal(caller.accountDomainId, "business-a");
    assert.match(caller.membershipId, /^membership:/u);
    assert.deepEqual(
      caller.scopes,
      ["asc.thread.read", "asc.thread.write"]
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("cryptographically valid but unbound external identity fails closed", async () => {
  const context = await setup();
  try {
    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(
        verified({ subject: "unbound-user" })
      ),
      identities: context.identities
    });

    await assert.rejects(
      () => resolver.resolve("token-value"),
      /not linked to an ASC Principal/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("token AccountDomain requires active Membership for resolved Principal", async () => {
  const context = await setup();
  try {
    await context.identities.registerAccountDomain({
      accountDomainId: "business-b",
      kind: "organization",
      name: "Business B"
    });

    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(
        verified({ accountDomainId: "business-b" })
      ),
      identities: context.identities
    });

    await assert.rejects(
      () => resolver.resolve("token-value"),
      /no active Membership/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("missing required MCP scope fails closed after identity resolution", async () => {
  const context = await setup();
  try {
    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(
        verified({ scopes: ["asc.thread.read"] })
      ),
      identities: context.identities
    });

    await assert.rejects(
      () => resolver.resolve("token-value", ["asc.thread.write"]),
      /missing required scope/i
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("resolver never persists or returns raw bearer token", async () => {
  const context = await setup();
  try {
    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(verified()),
      identities: context.identities
    });

    const caller = await resolver.resolve("super-secret-bearer");
    assert.equal("token" in caller, false);
    assert.equal(
      JSON.stringify(caller).includes("super-secret-bearer"),
      false
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});


test("armed pairing records candidate but MCP access still fails", async () => {
  const context = await setup();
  try {
    await context.identities.armAuthenticationIdentityPairing({
      principalId: "principal:owner",
      accountDomainId: "business-a",
      issuer: "https://auth.example.test",
      expiresAt: "2099-01-01T00:10:00.000Z",
      createdAt: "2099-01-01T00:00:00.000Z"
    });

    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(
        verified({ subject: "candidate-user" })
      ),
      identities: context.identities
    });

    await assert.rejects(
      () => resolver.resolve("token-value"),
      /awaiting owner approval/i
    );

    const pairings =
      await context.identities.listAuthenticationPairings("business-a");
    assert.equal(pairings.length, 1);
    assert.equal(pairings[0]?.state, "candidate_detected");
    assert.equal(pairings[0]?.candidateSubject, "candidate-user");
    assert.equal(
      await context.identities.resolveAuthenticationIdentity(
        "https://auth.example.test",
        "candidate-user"
      ),
      undefined
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("unbound identity with no armed pairing leaves identity state unchanged", async () => {
  const context = await setup();
  try {
    const before =
      await context.identities.listAuthenticationPairings("business-a");

    const resolver = new McpRequestIdentityResolver({
      verifier: new FakeVerifier(
        verified({ subject: "unpaired-user" })
      ),
      identities: context.identities
    });

    await assert.rejects(
      () => resolver.resolve("token-value"),
      /not linked to an ASC Principal/i
    );

    const after =
      await context.identities.listAuthenticationPairings("business-a");
    assert.deepEqual(after, before);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
