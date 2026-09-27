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
  ConversationThread,
  ThreadActivityEvent,
  ThreadCheckpoint
} from "../../domain/index.js";
import {
  ThreadRevisionConflictError,
  type SaveThreadSnapshotInput,
  type ThreadSnapshot,
  type ThreadStore
} from "../../ports/index.js";

const THREAD_FILE_SCHEMA_VERSION = 1 as const;

interface ThreadFile {
  readonly schemaVersion: typeof THREAD_FILE_SCHEMA_VERSION;
  readonly accountDomainId: string;
  readonly snapshots: readonly ThreadSnapshot[];
}

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function requiredDomain(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("ThreadStore AccountDomain cannot be empty.");
  return normalized;
}

function assertTenant(
  accountDomainId: string,
  thread: ConversationThread,
  checkpoints: readonly ThreadCheckpoint[],
  activities: readonly ThreadActivityEvent[]
): void {
  if (thread.accountDomainId !== accountDomainId) {
    throw new Error(
      "Thread belongs to " + thread.accountDomainId +
      ", not store " + accountDomainId + "."
    );
  }
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.accountDomainId !== accountDomainId ||
      checkpoint.threadId !== thread.threadId
    ) {
      throw new Error("Checkpoint does not belong to this Thread/AccountDomain.");
    }
  }
  for (const activity of activities) {
    if (
      activity.accountDomainId !== accountDomainId ||
      activity.threadId !== thread.threadId
    ) {
      throw new Error("Activity does not belong to this Thread/AccountDomain.");
    }
  }
}

function freezeSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
  assertTenant(
    snapshot.thread.accountDomainId,
    snapshot.thread,
    snapshot.checkpoints,
    snapshot.activities
  );
  return Object.freeze({
    revision: snapshot.revision,
    thread: Object.freeze({
      ...snapshot.thread,
      runtimeCapabilities: Object.freeze({
        ...snapshot.thread.runtimeCapabilities
      }),
      ...(snapshot.thread.externalReference
        ? { externalReference: Object.freeze({
            ...snapshot.thread.externalReference
          }) }
        : {})
    }),
    checkpoints: Object.freeze(
      snapshot.checkpoints.map((checkpoint) => Object.freeze({
        ...checkpoint,
        workReferences: Object.freeze([...checkpoint.workReferences]),
        evidenceReferences: Object.freeze([...checkpoint.evidenceReferences]),
        ...(checkpoint.lastSteering
          ? { lastSteering: Object.freeze({ ...checkpoint.lastSteering }) }
          : {})
      }))
    ),
    activities: Object.freeze(
      snapshot.activities.map((activity) => Object.freeze({ ...activity }))
    )
  });
}

function parseFile(raw: string, accountDomainId: string): ThreadFile {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.schemaVersion !== THREAD_FILE_SCHEMA_VERSION) {
    throw new Error(
      "Unsupported ThreadStore schema version: " +
      String(parsed.schemaVersion)
    );
  }
  if (parsed.accountDomainId !== accountDomainId) {
    throw new Error(
      "ThreadStore file belongs to AccountDomain " +
      String(parsed.accountDomainId) + ", not " + accountDomainId + "."
    );
  }
  if (!Array.isArray(parsed.snapshots)) {
    throw new Error("ThreadStore file must contain snapshots.");
  }

  const snapshots = (parsed.snapshots as ThreadSnapshot[]).map((snapshot) => {
    assertTenant(
      accountDomainId,
      snapshot.thread,
      snapshot.checkpoints,
      snapshot.activities
    );
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      throw new Error("Thread revision must be a positive integer.");
    }
    return freezeSnapshot(snapshot);
  });

  return Object.freeze({
    schemaVersion: THREAD_FILE_SCHEMA_VERSION,
    accountDomainId,
    snapshots: Object.freeze(snapshots)
  });
}

function emptyFile(accountDomainId: string): ThreadFile {
  return Object.freeze({
    schemaVersion: THREAD_FILE_SCHEMA_VERSION,
    accountDomainId,
    snapshots: Object.freeze([])
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class JsonFileThreadStore implements ThreadStore {
  readonly accountDomainId: string;
  readonly #path: string;
  readonly #lockPath: string;

  constructor(path: string, accountDomainId: string) {
    this.#path = path;
    this.#lockPath = path + ".lock";
    this.accountDomainId = requiredDomain(accountDomainId);
  }

  async #readUnlocked(): Promise<ThreadFile> {
    try {
      return parseFile(
        await readFile(this.#path, "utf8"),
        this.accountDomainId
      );
    } catch (error) {
      if (errno(error) === "ENOENT") return emptyFile(this.accountDomainId);
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
    throw new Error("Timed out acquiring ASC ThreadStore lock.");
  }

  async #write(file: ThreadFile): Promise<void> {
    const temporaryPath =
      this.#path + ".tmp-" + process.pid + "-" + Date.now();
    await writeFile(
      temporaryPath,
      JSON.stringify(file, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 }
    );
    await rename(temporaryPath, this.#path);
  }

  async list(): Promise<readonly ThreadSnapshot[]> {
    const file = await this.#readUnlocked();
    return Object.freeze(
      [...file.snapshots]
        .map((snapshot) => freezeSnapshot(snapshot))
        .sort((left, right) =>
          right.thread.updatedAt.localeCompare(left.thread.updatedAt)
        )
    );
  }

  async load(threadId: string): Promise<ThreadSnapshot | undefined> {
    const file = await this.#readUnlocked();
    const snapshot = file.snapshots.find(
      (candidate) => candidate.thread.threadId === threadId
    );
    return snapshot ? freezeSnapshot(snapshot) : undefined;
  }

  async create(thread: ConversationThread): Promise<ThreadSnapshot> {
    assertTenant(this.accountDomainId, thread, [], []);

    return this.#withLock(async () => {
      const file = await this.#readUnlocked();
      if (file.snapshots.some(
        (candidate) => candidate.thread.threadId === thread.threadId
      )) {
        throw new Error("Thread already exists: " + thread.threadId);
      }

      const snapshot = freezeSnapshot({
        revision: 1,
        thread,
        checkpoints: [],
        activities: []
      });
      await this.#write(Object.freeze({
        ...file,
        snapshots: Object.freeze([...file.snapshots, snapshot])
      }));
      return snapshot;
    });
  }

  async save(input: SaveThreadSnapshotInput): Promise<ThreadSnapshot> {
    return this.#withLock(async () => {
      const file = await this.#readUnlocked();
      const index = file.snapshots.findIndex(
        (candidate) => candidate.thread.threadId === input.threadId
      );
      if (index < 0) throw new Error("Unknown Thread: " + input.threadId);

      const current = file.snapshots[index]!;
      if (current.revision !== input.expectedRevision) {
        throw new ThreadRevisionConflictError(
          input.threadId,
          input.expectedRevision,
          current.revision
        );
      }
      if (input.thread.threadId !== input.threadId) {
        throw new Error("Thread ID mismatch.");
      }
      assertTenant(
        this.accountDomainId,
        input.thread,
        input.checkpoints,
        input.activities
      );

      const next = freezeSnapshot({
        revision: current.revision + 1,
        thread: input.thread,
        checkpoints: input.checkpoints,
        activities: input.activities
      });
      const snapshots = [...file.snapshots];
      snapshots[index] = next;
      await this.#write(Object.freeze({
        ...file,
        snapshots: Object.freeze(snapshots)
      }));
      return next;
    });
  }
}
