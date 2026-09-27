import type {
  ConversationThread,
  FounderRelayRecord,
  ThreadActivityEvent,
  ThreadCheckpoint
} from "../domain/index.js";

export interface ThreadSnapshot {
  readonly revision: number;
  readonly thread: ConversationThread;
  readonly checkpoints: readonly ThreadCheckpoint[];
  readonly activities: readonly ThreadActivityEvent[];
  readonly relays: readonly FounderRelayRecord[];
}

export interface SaveThreadSnapshotInput {
  readonly threadId: string;
  readonly expectedRevision: number;
  readonly thread: ConversationThread;
  readonly checkpoints: readonly ThreadCheckpoint[];
  readonly activities: readonly ThreadActivityEvent[];
  readonly relays: readonly FounderRelayRecord[];
}

export interface ThreadStore {
  readonly accountDomainId: string;

  list(): Promise<readonly ThreadSnapshot[]>;
  load(threadId: string): Promise<ThreadSnapshot | undefined>;
  create(thread: ConversationThread): Promise<ThreadSnapshot>;
  save(input: SaveThreadSnapshotInput): Promise<ThreadSnapshot>;
}

export class ThreadRevisionConflictError extends Error {
  readonly code = "thread_revision_conflict";

  constructor(threadId: string, expected: number, actual: number) {
    super(
      "Thread " + threadId + " revision conflict: expected " +
      expected + ", current " + actual + "."
    );
    this.name = "ThreadRevisionConflictError";
  }
}
