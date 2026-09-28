import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveConnectionFirstSetup
} from "../dist/application/index.js";

function input(overrides = {}) {
  return {
    databaseConfigured: true,
    databaseReadable: true,
    resourceConfigured: true,
    issuerConfigured: true,
    signingKeysReady: true,
    identityStateReadable: true,
    identityBound: true,
    chatgptEvidence: false,
    ...overrides
  };
}

test("missing database is the first onboarding action", () => {
  const result = deriveConnectionFirstSetup(input({
    databaseConfigured: false,
    databaseReadable: false,
    issuerConfigured: false,
    signingKeysReady: false,
    identityStateReadable: false,
    identityBound: false
  }));

  assert.equal(result.database, "missing");
  assert.equal(result.overall, "incomplete");
  assert.equal(result.nextAction, "connect_database");
  assert.equal(result.completedConnections, 0);
});

test("configured but unreadable database reports repair instead of connected", () => {
  const result = deriveConnectionFirstSetup(input({
    databaseReadable: false
  }));

  assert.equal(result.database, "error");
  assert.equal(result.identity, "error");
  assert.equal(result.nextAction, "repair_database");
});

test("connected database advances owner to identity connection", () => {
  const result = deriveConnectionFirstSetup(input({
    issuerConfigured: false,
    signingKeysReady: false,
    identityStateReadable: true,
    identityBound: false
  }));

  assert.equal(result.database, "connected");
  assert.equal(result.identity, "missing_issuer");
  assert.equal(result.nextAction, "connect_identity");
});

test("configured issuer and keys advance to identity pairing", () => {
  const result = deriveConnectionFirstSetup(input({
    identityBound: false
  }));

  assert.equal(result.identity, "ready_to_pair");
  assert.equal(result.nextAction, "start_pairing");
});

test("armed and candidate pairings have distinct next actions", () => {
  const armed = deriveConnectionFirstSetup(input({
    identityBound: false,
    pairingState: "armed"
  }));
  const candidate = deriveConnectionFirstSetup(input({
    identityBound: false,
    pairingState: "candidate_detected"
  }));

  assert.equal(armed.identity, "pairing");
  assert.equal(armed.nextAction, "complete_pairing");
  assert.equal(candidate.identity, "candidate");
  assert.equal(candidate.nextAction, "approve_identity");
});

test("identity-connected configuration is only ready to test ChatGPT", () => {
  const result = deriveConnectionFirstSetup(input());

  assert.equal(result.identity, "connected");
  assert.equal(result.chatgpt, "ready_to_test");
  assert.equal(result.overall, "ready_to_test");
  assert.equal(result.nextAction, "test_chatgpt");
  assert.equal(result.completedConnections, 2);
});

test("ChatGPT becomes connected only from durable bridge evidence", () => {
  const result = deriveConnectionFirstSetup(input({
    chatgptEvidence: true
  }));

  assert.equal(result.chatgpt, "connected");
  assert.equal(result.overall, "connected");
  assert.equal(result.nextAction, "complete");
  assert.equal(result.completedConnections, 3);
});

test("resource absence prevents ChatGPT test readiness even with identity bound", () => {
  const result = deriveConnectionFirstSetup(input({
    resourceConfigured: false
  }));

  assert.equal(result.chatgpt, "not_ready");
  assert.equal(result.overall, "incomplete");
});

test("signing-key discovery failure is an identity error", () => {
  const result = deriveConnectionFirstSetup(input({
    signingKeysReady: false
  }));

  assert.equal(result.identity, "error");
  assert.equal(result.nextAction, "repair_identity");
});


test("historical ChatGPT evidence does not bypass a broken current identity chain", () => {
  const result = deriveConnectionFirstSetup(input({
    signingKeysReady: false,
    chatgptEvidence: true
  }));

  assert.equal(result.identity, "error");
  assert.equal(result.chatgpt, "not_ready");
  assert.equal(result.overall, "incomplete");
});
