import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";

import type {
  AuthorizationFlow,
  AuthorizationFlowStore,
  ConsumeAuthorizationFlowInput,
  CreateAuthorizationFlowInput
} from "../../ports/index.js";

const SCHEMA_VERSION = 1 as const;

interface AuthorizationFlowFile {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly accountDomainId: string;
  readonly flows: readonly AuthorizationFlow[];
}

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(label + " is required.");
  return normalized;
}

function freezeFlow(flow: AuthorizationFlow): AuthorizationFlow {
  return Object.freeze({ ...flow });
}

function assertTenant(
  accountDomainId: string,
  flow: AuthorizationFlow
): void {
  if (flow.accountDomainId !== accountDomainId) {
    throw new Error(
      "Authorization flow belongs to " +
      flow.accountDomainId +
      ", not store " +
      accountDomainId +
      "."
    );
  }
}

function emptyFile(accountDomainId: string): AuthorizationFlowFile {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    accountDomainId,
    flows: Object.freeze([])
  });
}

function parseFile(
  raw: string,
  accountDomainId: string
): AuthorizationFlowFile {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      "Unsupported AuthorizationFlowStore schema version: " +
      String(parsed.schemaVersion)
    );
  }
  if (parsed.accountDomainId !== accountDomainId) {
    throw new Error(
      "AuthorizationFlowStore file belongs to AccountDomain " +
      String(parsed.accountDomainId) +
      ", not " +
      accountDomainId +
      "."
    );
  }
  if (!Array.isArray(parsed.flows)) {
    throw new Error(
      "AuthorizationFlowStore file must contain flows."
    );
  }

  const flows = (parsed.flows as AuthorizationFlow[]).map(
    (flow) => {
      assertTenant(accountDomainId, flow);
      return freezeFlow(flow);
    }
  );

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    accountDomainId,
    flows: Object.freeze(flows)
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class JsonFileAuthorizationFlowStore
  implements AuthorizationFlowStore
{
  readonly accountDomainId: string;
  readonly #path: string;
  readonly #lockPath: string;

  constructor(path: string, accountDomainId: string) {
    this.#path = path;
    this.#lockPath = path + ".lock";
    this.accountDomainId = required(
      accountDomainId,
      "AuthorizationFlowStore AccountDomain"
    );
  }

  async #readUnlocked(): Promise<AuthorizationFlowFile> {
    try {
      return parseFile(
        await readFile(this.#path, "utf8"),
        this.accountDomainId
      );
    } catch (error) {
      if (errno(error) === "ENOENT") {
        return emptyFile(this.accountDomainId);
      }
      throw error;
    }
  }

  async #write(file: AuthorizationFlowFile): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporaryPath =
      this.#path + ".tmp-" + process.pid + "-" + Date.now();

    await writeFile(
      temporaryPath,
      JSON.stringify(file, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 }
    );
    await rename(temporaryPath, this.#path);
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.#path), { recursive: true });

    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const handle = await open(this.#lockPath, "wx");
        try {
          return await operation();
        } finally {
          await handle.close();
          await unlink(this.#lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (errno(error) !== "EEXIST") throw error;
        await sleep(8);
      }
    }

    throw new Error(
      "Timed out acquiring AuthorizationFlowStore lock."
    );
  }

  async create(
    input: CreateAuthorizationFlowInput
  ): Promise<void> {
    assertTenant(this.accountDomainId, input.flow);

    await this.#withLock(async () => {
      const file = await this.#readUnlocked();
      if (
        file.flows.some(
          (flow) => flow.flowId === input.flow.flowId
        )
      ) {
        throw new Error(
          "Authorization flow already exists: " +
          input.flow.flowId
        );
      }

      await this.#write(Object.freeze({
        ...file,
        flows: Object.freeze([
          ...file.flows,
          freezeFlow(input.flow)
        ])
      }));
    });
  }

  async get(
    flowId: string
  ): Promise<AuthorizationFlow | undefined> {
    const file = await this.#readUnlocked();
    const flow = file.flows.find(
      (candidate) => candidate.flowId === flowId
    );
    return flow ? freezeFlow(flow) : undefined;
  }

  async consume(
    input: ConsumeAuthorizationFlowInput
  ): Promise<AuthorizationFlow> {
    return this.#withLock(async () => {
      const file = await this.#readUnlocked();
      const index = file.flows.findIndex(
        (flow) => flow.flowId === input.flowId
      );
      if (index < 0) {
        throw new Error("Unknown authorization flow.");
      }

      const flow = file.flows[index]!;
      assertTenant(this.accountDomainId, flow);
      if (flow.state !== "pending") {
        throw new Error(
          "Authorization flow has already been consumed."
        );
      }
      if (flow.stateHash !== input.stateHash) {
        throw new Error(
          "Authorization state does not match."
        );
      }
      if (Date.parse(flow.expiresAt) <= Date.parse(input.now)) {
        throw new Error("Authorization flow has expired.");
      }

      const consumed = freezeFlow({
        ...flow,
        state: "consumed",
        consumedAt: input.now
      });
      const flows = [...file.flows];
      flows[index] = consumed;

      await this.#write(Object.freeze({
        ...file,
        flows: Object.freeze(flows)
      }));
      return consumed;
    });
  }
}
