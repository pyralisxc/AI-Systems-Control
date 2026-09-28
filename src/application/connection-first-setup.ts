export const SETUP_DATABASE_STATES = [
  "missing",
  "connected",
  "error"
] as const;
export type SetupDatabaseState =
  (typeof SETUP_DATABASE_STATES)[number];

export const SETUP_IDENTITY_STATES = [
  "missing_issuer",
  "ready_to_pair",
  "pairing",
  "candidate",
  "connected",
  "error"
] as const;
export type SetupIdentityState =
  (typeof SETUP_IDENTITY_STATES)[number];

export const SETUP_CHATGPT_STATES = [
  "not_ready",
  "ready_to_test",
  "connected"
] as const;
export type SetupChatgptState =
  (typeof SETUP_CHATGPT_STATES)[number];

export const SETUP_OVERALL_STATES = [
  "incomplete",
  "ready_to_test",
  "connected"
] as const;
export type SetupOverallState =
  (typeof SETUP_OVERALL_STATES)[number];

export const SETUP_NEXT_ACTIONS = [
  "connect_database",
  "repair_database",
  "connect_identity",
  "repair_identity",
  "start_pairing",
  "complete_pairing",
  "approve_identity",
  "test_chatgpt",
  "complete"
] as const;
export type SetupNextAction =
  (typeof SETUP_NEXT_ACTIONS)[number];

export interface ConnectionFirstSetupInput {
  readonly databaseConfigured: boolean;
  readonly databaseReadable: boolean;
  readonly resourceConfigured: boolean;
  readonly issuerConfigured: boolean;
  readonly signingKeysReady: boolean;
  readonly identityStateReadable: boolean;
  readonly identityBound: boolean;
  readonly pairingState?: "armed" | "candidate_detected";
  readonly chatgptEvidence: boolean;
}

export interface ConnectionFirstSetupProjection {
  readonly database: SetupDatabaseState;
  readonly identity: SetupIdentityState;
  readonly chatgpt: SetupChatgptState;
  readonly overall: SetupOverallState;
  readonly nextAction: SetupNextAction;
  readonly completedConnections: number;
  readonly totalConnections: 3;
}

function databaseState(
  input: ConnectionFirstSetupInput
): SetupDatabaseState {
  if (!input.databaseConfigured) return "missing";
  return input.databaseReadable ? "connected" : "error";
}

function identityState(
  input: ConnectionFirstSetupInput,
  database: SetupDatabaseState
): SetupIdentityState {
  if (!input.issuerConfigured) return "missing_issuer";
  if (
    database !== "connected" ||
    !input.signingKeysReady ||
    !input.identityStateReadable
  ) {
    return "error";
  }
  if (input.identityBound) return "connected";
  if (input.pairingState === "candidate_detected") return "candidate";
  if (input.pairingState === "armed") return "pairing";
  return "ready_to_pair";
}

function chatgptState(
  input: ConnectionFirstSetupInput,
  database: SetupDatabaseState,
  identity: SetupIdentityState
): SetupChatgptState {
  if (input.chatgptEvidence) return "connected";
  if (
    database === "connected" &&
    identity === "connected" &&
    input.resourceConfigured &&
    input.signingKeysReady
  ) {
    return "ready_to_test";
  }
  return "not_ready";
}

function nextAction(
  database: SetupDatabaseState,
  identity: SetupIdentityState,
  chatgpt: SetupChatgptState
): SetupNextAction {
  if (database === "missing") return "connect_database";
  if (database === "error") return "repair_database";

  if (identity === "missing_issuer") return "connect_identity";
  if (identity === "error") return "repair_identity";
  if (identity === "ready_to_pair") return "start_pairing";
  if (identity === "pairing") return "complete_pairing";
  if (identity === "candidate") return "approve_identity";

  if (chatgpt === "ready_to_test") return "test_chatgpt";
  if (chatgpt === "connected") return "complete";

  return "test_chatgpt";
}

export function deriveConnectionFirstSetup(
  input: ConnectionFirstSetupInput
): ConnectionFirstSetupProjection {
  const database = databaseState(input);
  const identity = identityState(input, database);
  const chatgpt = chatgptState(input, database, identity);

  const completedConnections =
    (database === "connected" ? 1 : 0) +
    (identity === "connected" ? 1 : 0) +
    (chatgpt === "connected" ? 1 : 0);

  const overall: SetupOverallState =
    chatgpt === "connected"
      ? "connected"
      : chatgpt === "ready_to_test"
        ? "ready_to_test"
        : "incomplete";

  return Object.freeze({
    database,
    identity,
    chatgpt,
    overall,
    nextAction: nextAction(database, identity, chatgpt),
    completedConnections,
    totalConnections: 3
  });
}
