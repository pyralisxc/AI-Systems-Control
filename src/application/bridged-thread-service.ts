import { randomUUID } from "node:crypto";

import type {
  ConversationThread,
  PulseProjection,
  SteeringReference,
  ThreadActivityEvent,
  ThreadActivityKind,
  ThreadCheckpoint,
  ThreadGate,
  ThreadMode,
  ThreadRuntimeCapabilities
} from "../domain/index.js";
import {
  ThreadRevisionConflictError,
  type ThreadSnapshot,
  type ThreadStore
} from "../ports/index.js";
import { derivePulseStatus } from "./pulse-evaluator.js";
import { PersistentProjectRegistry } from "./persistent-project-registry.js";

export interface RegisterBridgedThreadInput {
  readonly title: string;
  readonly purpose?: string;
  readonly projectId?: string;
  readonly mode?: Extract<ThreadMode, "external" | "bridged">;
  readonly provider: string;
  readonly externalThreadId?: string;
  readonly navigationUrl?: string;
  readonly createdAt?: string;
}

export interface PublishThreadCheckpointInput {
  readonly threadId: string;
  readonly synopsis: string;
  readonly gate?: ThreadGate;
  readonly blocker?: string;
  readonly workReferences?: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly publishedByPrincipalId?: string;
  readonly lastSteering?: SteeringReference;
  readonly supersedesCheckpointId?: string;
  readonly publishedAt?: string;
}

export interface RecordThreadActivityInput {
  readonly threadId: string;
  readonly kind: ThreadActivityKind;
  readonly source: string;
  readonly signature?: string;
  readonly summary?: string;
  readonly evidenceReference?: string;
  readonly publishedByPrincipalId?: string;
  readonly occurredAt?: string;
}

export class BridgedThreadError extends Error {
  readonly code = "bridged_thread_failed";

  constructor(message: string) {
    super(message);
    this.name = "BridgedThreadError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BridgedThreadError(label + " is required.");
  return normalized;
}

function navigationUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new BridgedThreadError(
      "Thread navigation URL must be an absolute URL."
    );
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (
    url.protocol !== "https:" &&
    !(loopback && url.protocol === "http:")
  ) {
    throw new BridgedThreadError(
      "Thread navigation URL must use HTTPS outside localhost."
    );
  }
  if (url.username || url.password) {
    throw new BridgedThreadError(
      "Thread navigation URL must not contain credentials."
    );
  }

  return url.toString();
}

function capabilities(mode: Extract<ThreadMode, "external" | "bridged">): ThreadRuntimeCapabilities {
  if (mode === "bridged") {
    return Object.freeze({
      canPublishCheckpoint: true,
      canSteer: false,
      canInterrupt: false,
      canStopRuntime: false,
      canAutoSendRelay: false
    });
  }
  return Object.freeze({
    canPublishCheckpoint: false,
    canSteer: false,
    canInterrupt: false,
    canStopRuntime: false,
    canAutoSendRelay: false
  });
}

function nextLifecycle(
  thread: ConversationThread,
  checkpoint: ThreadCheckpoint
): ConversationThread["lifecycle"] {
  if (checkpoint.gate === "owner") return "waiting_owner";
  if (thread.lifecycle === "completed" || thread.lifecycle === "archived") {
    return thread.lifecycle;
  }
  return "active";
}

function validateSteering(steering: SteeringReference | undefined): void {
  if (!steering) return;
  required(steering.text, "Steering text");
  if (
    (
      steering.actor === "owner" ||
      steering.actor === "owner_assisted" ||
      steering.actor === "founder_relay"
    ) &&
    !steering.principalId
  ) {
    throw new BridgedThreadError(
      "Owner-channel steering requires Principal provenance."
    );
  }
}

export class BridgedThreadService {
  readonly #store: ThreadStore;
  readonly #projects: PersistentProjectRegistry;

  constructor(store: ThreadStore, projects: PersistentProjectRegistry) {
    this.#store = store;
    this.#projects = projects;
  }

  async #mutate(
    threadId: string,
    mutate: (snapshot: ThreadSnapshot) => {
      readonly thread: ConversationThread;
      readonly checkpoints: readonly ThreadCheckpoint[];
      readonly activities: readonly ThreadActivityEvent[];
      readonly relays: ThreadSnapshot["relays"];
    },
    maxAttempts = 5
  ): Promise<ThreadSnapshot> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const snapshot = await this.#store.load(threadId);
      if (!snapshot) throw new BridgedThreadError("Unknown Thread: " + threadId);
      const next = mutate(snapshot);
      try {
        return await this.#store.save({
          threadId,
          expectedRevision: snapshot.revision,
          thread: next.thread,
          checkpoints: next.checkpoints,
          activities: next.activities,
          relays: next.relays
        });
      } catch (error) {
        if (
          !(error instanceof ThreadRevisionConflictError) ||
          attempt === maxAttempts - 1
        ) {
          throw error;
        }
      }
    }
    throw new BridgedThreadError("Thread mutation exhausted retry budget.");
  }

  async registerExternal(
    input: RegisterBridgedThreadInput
  ): Promise<ConversationThread> {
    if (input.projectId) {
      const project = await this.#projects.get(input.projectId);
      if (!project) {
        throw new BridgedThreadError("Unknown Project: " + input.projectId);
      }
      if (project.accountDomainId !== this.#store.accountDomainId) {
        throw new BridgedThreadError(
          "Project belongs to a different AccountDomain."
        );
      }
    }

    const mode = input.mode ?? "bridged";
    const createdAt = input.createdAt ?? new Date().toISOString();
    const thread: ConversationThread = Object.freeze({
      threadId: "thread:" + randomUUID(),
      accountDomainId: this.#store.accountDomainId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      title: required(input.title, "Thread title"),
      ...(input.purpose ? { purpose: input.purpose.trim() } : {}),
      mode,
      lifecycle: "active",
      runtimeCapabilities: capabilities(mode),
      externalReference: Object.freeze({
        provider: required(input.provider, "External provider"),
        ...(input.externalThreadId
          ? { externalThreadId: input.externalThreadId.trim() }
          : {}),
        ...(navigationUrl(input.navigationUrl)
          ? { navigationUrl: navigationUrl(input.navigationUrl)! }
          : {})
      }),
      createdAt,
      updatedAt: createdAt
    });

    await this.#store.create(thread);
    return thread;
  }

  async publishCheckpoint(
    input: PublishThreadCheckpointInput
  ): Promise<ThreadCheckpoint> {
    validateSteering(input.lastSteering);
    const synopsis = required(input.synopsis, "Checkpoint synopsis");
    const publishedAt = input.publishedAt ?? new Date().toISOString();
    let published: ThreadCheckpoint | undefined;

    await this.#mutate(input.threadId, (snapshot) => {
      if (!snapshot.thread.runtimeCapabilities.canPublishCheckpoint) {
        throw new BridgedThreadError(
          "This external Thread cannot publish checkpoints."
        );
      }
      if (
        input.supersedesCheckpointId &&
        !snapshot.checkpoints.some(
          (checkpoint) =>
            checkpoint.checkpointId === input.supersedesCheckpointId
        )
      ) {
        throw new BridgedThreadError(
          "Superseded checkpoint does not exist in this Thread."
        );
      }

      const checkpoint: ThreadCheckpoint = Object.freeze({
        checkpointId: "checkpoint:" + randomUUID(),
        threadId: snapshot.thread.threadId,
        accountDomainId: this.#store.accountDomainId,
        publishedAt,
        synopsis,
        gate: input.gate ?? "none",
        ...(input.blocker ? { blocker: input.blocker.trim() } : {}),
        workReferences: Object.freeze([
          ...new Set(input.workReferences ?? [])
        ]),
        evidenceReferences: Object.freeze([
          ...new Set(input.evidenceReferences ?? [])
        ]),
        ...(input.publishedByPrincipalId
          ? { publishedByPrincipalId: input.publishedByPrincipalId }
          : {}),
        ...(input.supersedesCheckpointId
          ? { supersedesCheckpointId: input.supersedesCheckpointId }
          : {}),
        ...(input.lastSteering
          ? { lastSteering: Object.freeze({ ...input.lastSteering }) }
          : {})
      });
      published = checkpoint;

      const activity: ThreadActivityEvent = Object.freeze({
        activityId: "activity:" + randomUUID(),
        threadId: snapshot.thread.threadId,
        accountDomainId: this.#store.accountDomainId,
        occurredAt: publishedAt,
        kind: "checkpoint",
        source: "asc-bridge",
        summary: synopsis,
        ...(input.publishedByPrincipalId
          ? { publishedByPrincipalId: input.publishedByPrincipalId }
          : {})
      });

      return {
        thread: Object.freeze({
          ...snapshot.thread,
          lifecycle: nextLifecycle(snapshot.thread, checkpoint),
          updatedAt: publishedAt
        }),
        checkpoints: [...snapshot.checkpoints, checkpoint],
        activities: [...snapshot.activities, activity],
        relays: snapshot.relays
      };
    });

    return published!;
  }

  async refineSynopsis(input: {
    readonly threadId: string;
    readonly checkpointId: string;
    readonly synopsis: string;
    readonly principalId: string;
    readonly publishedAt?: string;
  }): Promise<ThreadCheckpoint> {
    const snapshot = await this.#store.load(input.threadId);
    if (!snapshot) throw new BridgedThreadError("Unknown Thread: " + input.threadId);
    const previous = snapshot.checkpoints.find(
      (checkpoint) => checkpoint.checkpointId === input.checkpointId
    );
    if (!previous) {
      throw new BridgedThreadError("Unknown checkpoint: " + input.checkpointId);
    }

    return this.publishCheckpoint({
      threadId: input.threadId,
      synopsis: input.synopsis,
      gate: previous.gate,
      ...(previous.blocker ? { blocker: previous.blocker } : {}),
      workReferences: previous.workReferences,
      evidenceReferences: previous.evidenceReferences,
      publishedByPrincipalId: input.principalId,
      supersedesCheckpointId: previous.checkpointId,
      ...(previous.lastSteering
        ? { lastSteering: previous.lastSteering }
        : {}),
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {})
    });
  }

  async recordActivity(
    input: RecordThreadActivityInput
  ): Promise<ThreadActivityEvent> {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    let published: ThreadActivityEvent | undefined;

    await this.#mutate(input.threadId, (snapshot) => {
      const activity: ThreadActivityEvent = Object.freeze({
        activityId: "activity:" + randomUUID(),
        threadId: snapshot.thread.threadId,
        accountDomainId: this.#store.accountDomainId,
        occurredAt,
        kind: input.kind,
        source: required(input.source, "Activity source"),
        ...(input.signature ? { signature: input.signature.trim() } : {}),
        ...(input.summary ? { summary: input.summary.trim() } : {}),
        ...(input.evidenceReference
          ? { evidenceReference: input.evidenceReference.trim() }
          : {}),
        ...(input.publishedByPrincipalId
          ? { publishedByPrincipalId: input.publishedByPrincipalId }
          : {})
      });
      published = activity;

      const lifecycle =
        input.kind === "completed"
          ? "completed"
          : input.kind === "owner_gate"
            ? "waiting_owner"
            : snapshot.thread.lifecycle === "completed" ||
                snapshot.thread.lifecycle === "archived"
              ? snapshot.thread.lifecycle
              : "active";

      return {
        thread: Object.freeze({
          ...snapshot.thread,
          lifecycle,
          updatedAt: occurredAt
        }),
        checkpoints: snapshot.checkpoints,
        activities: [...snapshot.activities, activity],
        relays: snapshot.relays
      };
    });

    return published!;
  }

  async getPulse(
    threadId: string,
    now?: string
  ): Promise<PulseProjection> {
    const snapshot = await this.#store.load(threadId);
    if (!snapshot) throw new BridgedThreadError("Unknown Thread: " + threadId);
    return derivePulseStatus({
      thread: snapshot.thread,
      checkpoints: snapshot.checkpoints,
      activities: snapshot.activities,
      ...(now ? { now } : {})
    });
  }

  async listPulse(now?: string): Promise<readonly PulseProjection[]> {
    const snapshots = await this.#store.list();
    return Object.freeze(
      snapshots.map((snapshot) =>
        derivePulseStatus({
          thread: snapshot.thread,
          checkpoints: snapshot.checkpoints,
          activities: snapshot.activities,
          ...(now ? { now } : {})
        })
      )
    );
  }

  async getThread(threadId: string): Promise<ThreadSnapshot | undefined> {
    return this.#store.load(threadId);
  }
}
