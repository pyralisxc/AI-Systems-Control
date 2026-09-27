import { createHash } from "node:crypto";

import type {
  WorkEnvelope
} from "../domain/index.js";
import type {
  ThreadStore
} from "../ports/index.js";
import {
  ContinuationAuthorityService
} from "./continuation-authority-service.js";
import {
  WorkerAuthorityService
} from "./worker-authority-service.js";

export interface EnableThreadContinueInput {
  readonly threadId: string;
  readonly reviewedByPrincipalId: string;
  readonly createdAt?: string;
}

export interface EnableThreadContinueResult {
  readonly changed: boolean;
  readonly envelope: WorkEnvelope;
  readonly grantId: string;
}

export class ThreadContinueReviewError extends Error {
  readonly code = "thread_continue_review_failed";

  constructor(message: string) {
    super(message);
    this.name = "ThreadContinueReviewError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ThreadContinueReviewError(label + " is required.");
  }
  return normalized;
}

function latestRelay(snapshot: Awaited<ReturnType<ThreadStore["load"]>>) {
  if (!snapshot) return undefined;
  return [...snapshot.relays]
    .sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt) ||
      right.relayId.localeCompare(left.relayId)
    )[0];
}

function scopeFingerprint(input: {
  readonly accountDomainId: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly workClass: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      accountDomainId: input.accountDomainId,
      projectId: input.projectId,
      threadId: input.threadId,
      workClass: input.workClass,
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      allowedCapabilities: [],
      continuationPolicy: "continue_until_gate"
    }))
    .digest("hex");

  return "sha256:" + digest;
}

function equivalentReadOnlyEnvelope(
  envelope: WorkEnvelope | undefined,
  input: {
    readonly threadId: string;
    readonly objectiveRef: string;
    readonly scopeFingerprint: string;
    readonly workClass: string;
  }
): envelope is WorkEnvelope {
  return Boolean(
    envelope &&
    envelope.state === "active" &&
    envelope.threadId === input.threadId &&
    envelope.objectiveRef === input.objectiveRef &&
    envelope.scopeFingerprint === input.scopeFingerprint &&
    envelope.workClasses.length === 1 &&
    envelope.workClasses[0] === input.workClass &&
    envelope.allowedEffects.length === 1 &&
    envelope.allowedEffects[0] === "read" &&
    envelope.repositoryBoundary === "read_only" &&
    envelope.allowedCapabilities.length === 0 &&
    envelope.continuationPolicy === "continue_until_gate" &&
    envelope.authorizationId === undefined
  );
}

export class ThreadContinueReviewService {
  readonly #threads: ThreadStore;
  readonly #continuation: ContinuationAuthorityService;
  readonly #workers: WorkerAuthorityService;

  constructor(input: {
    readonly threadStore: ThreadStore;
    readonly continuation: ContinuationAuthorityService;
    readonly workers: WorkerAuthorityService;
  }) {
    this.#threads = input.threadStore;
    this.#continuation = input.continuation;
    this.#workers = input.workers;
  }

  async enableReadOnlyContinue(
    input: EnableThreadContinueInput
  ): Promise<EnableThreadContinueResult> {
    const threadId = required(input.threadId, "Thread");
    const reviewedByPrincipalId = required(
      input.reviewedByPrincipalId,
      "Reviewing Principal"
    );

    const snapshot = await this.#threads.load(threadId);
    if (!snapshot) {
      throw new ThreadContinueReviewError(
        "Unknown Thread: " + threadId
      );
    }
    if (!snapshot.thread.projectId) {
      throw new ThreadContinueReviewError(
        "Read-only Continue requires a Project-scoped Thread."
      );
    }

    const relay = latestRelay(snapshot);
    if (!relay) {
      throw new ThreadContinueReviewError(
        "Read-only Continue requires an existing Founder Relay scope."
      );
    }
    if (relay.representedPrincipalId !== reviewedByPrincipalId) {
      throw new ThreadContinueReviewError(
        "Only the represented Principal may enable Continue for this Relay scope."
      );
    }
    if (relay.projectId !== snapshot.thread.projectId) {
      throw new ThreadContinueReviewError(
        "Founder Relay Project does not match the Thread Project."
      );
    }

    const grant = await this.#continuation.getLatestAutonomyGrant(
      relay.projectId,
      relay.workClass
    );
    if (
      !grant ||
      grant.state !== "active" ||
      grant.level < 2
    ) {
      throw new ThreadContinueReviewError(
        "An active Level 2-or-higher AutonomyGrant is required."
      );
    }

    const control = await this.#workers.getProjectControl(
      relay.projectId
    );
    if (control.mode !== "running") {
      throw new ThreadContinueReviewError(
        "Project ControlState does not permit continuation."
      );
    }

    const objectiveRef = snapshot.thread.threadId;
    const fingerprint = scopeFingerprint({
      accountDomainId: this.#threads.accountDomainId,
      projectId: relay.projectId,
      threadId: snapshot.thread.threadId,
      workClass: relay.workClass
    });

    const existing =
      await this.#continuation.getLatestWorkEnvelope(
        relay.projectId,
        relay.workClass,
        snapshot.thread.threadId
      );

    if (
      equivalentReadOnlyEnvelope(existing, {
        threadId: snapshot.thread.threadId,
        objectiveRef,
        scopeFingerprint: fingerprint,
        workClass: relay.workClass
      })
    ) {
      return Object.freeze({
        changed: false,
        envelope: existing,
        grantId: grant.grantId
      });
    }

    const envelope = await this.#continuation.createEnvelope({
      projectId: relay.projectId,
      threadId: snapshot.thread.threadId,
      objectiveRef,
      scopeFingerprint: fingerprint,
      workClasses: [relay.workClass],
      allowedEffects: ["read"],
      repositoryBoundary: "read_only",
      allowedCapabilities: [],
      continuationPolicy: "continue_until_gate",
      ownerGateConditions: ["explicit_owner_gate"],
      createdByPrincipalId: reviewedByPrincipalId,
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    });

    return Object.freeze({
      changed: true,
      envelope,
      grantId: grant.grantId
    });
  }
}
