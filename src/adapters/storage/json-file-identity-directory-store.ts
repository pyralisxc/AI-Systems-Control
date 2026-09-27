import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  IDENTITY_DIRECTORY_SCHEMA_VERSION,
  IdentityDirectoryRevisionConflictError,
  emptyIdentityDirectorySnapshot,
  type IdentityDirectorySnapshot,
  type IdentityDirectoryStore,
  type SaveIdentityDirectoryInput
} from "../../ports/index.js";

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function freezeSnapshot(
  snapshot: IdentityDirectorySnapshot
): IdentityDirectorySnapshot {
  return Object.freeze({
    ...snapshot,
    principals: Object.freeze([...snapshot.principals]),
    accountDomains: Object.freeze([...snapshot.accountDomains]),
    memberships: Object.freeze([...snapshot.memberships])
  });
}

function parseSnapshot(raw: string): IdentityDirectorySnapshot {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.schemaVersion !== IDENTITY_DIRECTORY_SCHEMA_VERSION) {
    throw new Error(
      "Unsupported identity directory schema version: " +
      String(parsed.schemaVersion)
    );
  }
  if (!Number.isInteger(parsed.revision) || Number(parsed.revision) < 0) {
    throw new Error("Identity directory revision must be non-negative.");
  }
  if (
    !Array.isArray(parsed.principals) ||
    !Array.isArray(parsed.accountDomains) ||
    !Array.isArray(parsed.memberships)
  ) {
    throw new Error(
      "Identity directory must contain principals, accountDomains, and memberships."
    );
  }

  return freezeSnapshot({
    schemaVersion: IDENTITY_DIRECTORY_SCHEMA_VERSION,
    revision: Number(parsed.revision),
    principals: parsed.principals as IdentityDirectorySnapshot["principals"],
    accountDomains:
      parsed.accountDomains as IdentityDirectorySnapshot["accountDomains"],
    memberships: parsed.memberships as IdentityDirectorySnapshot["memberships"],
    ...(typeof parsed.updatedAt === "string"
      ? { updatedAt: parsed.updatedAt }
      : {})
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class JsonFileIdentityDirectoryStore
implements IdentityDirectoryStore {
  readonly #path: string;
  readonly #lockPath: string;

  constructor(path: string) {
    this.#path = path;
    this.#lockPath = path + ".lock";
  }

  async #readUnlocked(): Promise<IdentityDirectorySnapshot> {
    try {
      return parseSnapshot(await readFile(this.#path, "utf8"));
    } catch (error) {
      if (errno(error) === "ENOENT") return emptyIdentityDirectorySnapshot();
      throw error;
    }
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
    throw new Error("Timed out acquiring ASC identity-directory lock.");
  }

  async load(): Promise<IdentityDirectorySnapshot> {
    return this.#readUnlocked();
  }

  async save(
    input: SaveIdentityDirectoryInput
  ): Promise<IdentityDirectorySnapshot> {
    return this.#withLock(async () => {
      const current = await this.#readUnlocked();
      if (current.revision !== input.expectedRevision) {
        throw new IdentityDirectoryRevisionConflictError(
          input.expectedRevision,
          current.revision
        );
      }

      const next: IdentityDirectorySnapshot = {
        schemaVersion: IDENTITY_DIRECTORY_SCHEMA_VERSION,
        revision: current.revision + 1,
        principals: Object.freeze([...input.principals]),
        accountDomains: Object.freeze([...input.accountDomains]),
        memberships: Object.freeze([...input.memberships]),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {})
      };

      const temporaryPath =
        this.#path + ".tmp-" + process.pid + "-" + Date.now();
      await writeFile(
        temporaryPath,
        JSON.stringify(next, null, 2) + "\n",
        { encoding: "utf8", mode: 0o600 }
      );
      await rename(temporaryPath, this.#path);
      return freezeSnapshot(next);
    });
  }
}
