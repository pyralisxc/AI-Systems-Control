import type {
  ConversationThread,
  FounderRelayRecord,
  ThreadActivityEvent,
  ThreadCheckpoint
} from "../domain/index.js";
import {
  ThreadRevisionConflictError,
  type SaveThreadSnapshotInput,
  type ThreadSnapshot,
  type ThreadStore
} from "../ports/index.js";

function freezeSnapshot(snapshot: ThreadSnapshot): ThreadSnapshot {
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
    ),
    relays: Object.freeze(
      snapshot.relays.map((relay) => Object.freeze({
        ...relay,
        sourceReferences: Object.freeze([...relay.sourceReferences]),
        evidenceReferences: Object.freeze([...relay.evidenceReferences]),
        proposalAuthority: Object.freeze({
          ...relay.proposalAuthority,
          basis: Object.freeze({ ...relay.proposalAuthority.basis })
        }),
        ...(relay.deliveryAuthority
          ? {
              deliveryAuthority: Object.freeze({
                ...relay.deliveryAuthority,
                basis: Object.freeze({ ...relay.deliveryAuthority.basis })
              })
            }
          : {})
      }))
    )
  });
}

function assertTenant(
  accountDomainId: string,
  thread: ConversationThread,
  checkpoints: readonly ThreadCheckpoint[],
  activities: readonly ThreadActivityEvent[],
  relays: readonly FounderRelayRecord[]
): void {
  if (thread.accountDomainId !== accountDomainId) {
    throw new Error(
      "Thread belongs to " + thread.accountDomainId +
      ", not store " + accountDomainId + "."
    );
  }
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.threadId !== thread.threadId ||
      checkpoint.accountDomainId !== accountDomainId
    ) {
      throw new Error("Checkpoint does not belong to this Thread/AccountDomain.");
    }
  }
  for (const activity of activities) {
    if (
      activity.threadId !== thread.threadId ||
      activity.accountDomainId !== accountDomainId
    ) {
      throw new Error("Activity does not belong to this Thread/AccountDomain.");
    }
  }
  for (const relay of relays) {
    if (
      relay.threadId !== thread.threadId ||
      relay.accountDomainId !== accountDomainId
    ) {
      throw new Error("Relay does not belong to this Thread/AccountDomain.");
    }
  }
}

export class InMemoryThreadStore implements ThreadStore {
  readonly accountDomainId: string;
  readonly #snapshots = new Map<string, ThreadSnapshot>();

  constructor(accountDomainId: string) {
    const normalized = accountDomainId.trim();
    if (!normalized) throw new Error("ThreadStore AccountDomain cannot be empty.");
    this.accountDomainId = normalized;
  }

  async list(): Promise<readonly ThreadSnapshot[]> {
    return Object.freeze(
      [...this.#snapshots.values()]
        .map((snapshot) => freezeSnapshot(snapshot))
        .sort((left, right) =>
          right.thread.updatedAt.localeCompare(left.thread.updatedAt)
        )
    );
  }

  async load(threadId: string): Promise<ThreadSnapshot | undefined> {
    const snapshot = this.#snapshots.get(threadId);
    return snapshot ? freezeSnapshot(snapshot) : undefined;
  }

  async create(thread: ConversationThread): Promise<ThreadSnapshot> {
    if (this.#snapshots.has(thread.threadId)) {
      throw new Error("Thread already exists: " + thread.threadId);
    }
    assertTenant(this.accountDomainId, thread, [], [], []);
    const snapshot = freezeSnapshot({
      revision: 1,
      thread,
      checkpoints: [],
      activities: [],
      relays: []
    });
    this.#snapshots.set(thread.threadId, snapshot);
    return snapshot;
  }

  async save(input: SaveThreadSnapshotInput): Promise<ThreadSnapshot> {
    const current = this.#snapshots.get(input.threadId);
    if (!current) throw new Error("Unknown Thread: " + input.threadId);
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
      input.activities,
      input.relays
    );

    const next = freezeSnapshot({
      revision: current.revision + 1,
      thread: input.thread,
      checkpoints: input.checkpoints,
      activities: input.activities,
      relays: input.relays
    });
    this.#snapshots.set(input.threadId, next);
    return next;
  }
}
