import { Pool } from "pg";

import type {
  AuthorizationFlow,
  AuthorizationFlowStore,
  ConsumeAuthorizationFlowInput,
  CreateAuthorizationFlowInput
} from "../../ports/index.js";
import type {
  PostgresQueryClient
} from "./postgres-control-registry-store.js";

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + " is required.");
  return normalized;
}

function decode(row: Record<string, unknown>): AuthorizationFlow {
  const payload =
    typeof row.payload === "string"
      ? JSON.parse(row.payload) as AuthorizationFlow
      : row.payload as AuthorizationFlow;
  return Object.freeze({ ...payload });
}

export class PostgresAuthorizationFlowStore
  implements AuthorizationFlowStore
{
  readonly accountDomainId: string;
  readonly #client: PostgresQueryClient;
  readonly #close: (() => Promise<void>) | undefined;
  #ready?: Promise<void>;

  constructor(
    client: PostgresQueryClient,
    accountDomainId: string,
    close?: () => Promise<void>
  ) {
    this.#client = client;
    this.accountDomainId = required(
      accountDomainId,
      "AuthorizationFlowStore AccountDomain"
    );
    this.#close = close;
  }

  static fromConnectionString(
    connectionString: string,
    accountDomainId: string
  ): PostgresAuthorizationFlowStore {
    const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    return new PostgresAuthorizationFlowStore(
      {
        query: async (text, values) => {
          const result = await pool.query(
            text,
            values ? [...values] : undefined
          );
          return {
            rowCount: result.rowCount,
            rows:
              result.rows as readonly Record<string, unknown>[]
          };
        }
      },
      accountDomainId,
      () => pool.end()
    );
  }

  async #ensureTable(): Promise<void> {
    this.#ready ??= this.#client.query(
      [
        "CREATE TABLE IF NOT EXISTS asc_authorization_flow (",
        "account_domain_id text NOT NULL,",
        "flow_id text NOT NULL,",
        "state_hash text NOT NULL,",
        "state text NOT NULL,",
        "expires_at timestamptz NOT NULL,",
        "payload jsonb NOT NULL,",
        "updated_at timestamptz NOT NULL DEFAULT now(),",
        "PRIMARY KEY (account_domain_id, flow_id)",
        ")"
      ].join(" ")
    ).then(() => undefined);
    await this.#ready;
  }

  async create(
    input: CreateAuthorizationFlowInput
  ): Promise<void> {
    await this.#ensureTable();

    if (input.flow.accountDomainId !== this.accountDomainId) {
      throw new Error(
        "Authorization flow belongs to another AccountDomain."
      );
    }

    const result = await this.#client.query(
      [
        "INSERT INTO asc_authorization_flow",
        "(account_domain_id, flow_id, state_hash, state, expires_at, payload, updated_at)",
        "VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7::timestamptz)",
        "ON CONFLICT (account_domain_id, flow_id) DO NOTHING",
        "RETURNING flow_id"
      ].join(" "),
      [
        this.accountDomainId,
        input.flow.flowId,
        input.flow.stateHash,
        input.flow.state,
        input.flow.expiresAt,
        JSON.stringify(input.flow),
        input.flow.createdAt
      ]
    );

    if (result.rows.length === 0) {
      throw new Error(
        "Authorization flow already exists: " +
        input.flow.flowId
      );
    }
  }

  async get(
    flowId: string
  ): Promise<AuthorizationFlow | undefined> {
    await this.#ensureTable();

    const result = await this.#client.query(
      [
        "SELECT payload FROM asc_authorization_flow",
        "WHERE account_domain_id = $1 AND flow_id = $2"
      ].join(" "),
      [this.accountDomainId, flowId]
    );

    if (result.rows.length === 0) return undefined;
    const flow = decode(result.rows[0]!);
    if (flow.accountDomainId !== this.accountDomainId) {
      throw new Error(
        "Authorization flow belongs to another AccountDomain."
      );
    }
    return flow;
  }

  async consume(
    input: ConsumeAuthorizationFlowInput
  ): Promise<AuthorizationFlow> {
    await this.#ensureTable();

    const current = await this.get(input.flowId);
    if (!current) {
      throw new Error("Unknown authorization flow.");
    }
    if (current.state !== "pending") {
      throw new Error(
        "Authorization flow has already been consumed."
      );
    }
    if (current.stateHash !== input.stateHash) {
      throw new Error("Authorization state does not match.");
    }
    if (Date.parse(current.expiresAt) <= Date.parse(input.now)) {
      throw new Error("Authorization flow has expired.");
    }

    const consumed: AuthorizationFlow = Object.freeze({
      ...current,
      state: "consumed",
      consumedAt: input.now
    });

    const result = await this.#client.query(
      [
        "UPDATE asc_authorization_flow",
        "SET state = 'consumed', payload = $4::jsonb, updated_at = $5::timestamptz",
        "WHERE account_domain_id = $1 AND flow_id = $2",
        "AND state = 'pending' AND state_hash = $3",
        "RETURNING payload"
      ].join(" "),
      [
        this.accountDomainId,
        input.flowId,
        input.stateHash,
        JSON.stringify(consumed),
        input.now
      ]
    );

    if (result.rows.length === 0) {
      throw new Error(
        "Authorization flow could not be consumed atomically."
      );
    }

    return decode(result.rows[0]!);
  }

  async close(): Promise<void> {
    if (this.#close) await this.#close();
  }
}
