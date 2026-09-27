import type {
  ConversationThread,
  PulseProjection,
  ThreadActivityEvent,
  ThreadCheckpoint
} from "../domain/index.js";

export interface PulseEvaluationInput {
  readonly thread: ConversationThread;
  readonly checkpoints: readonly ThreadCheckpoint[];
  readonly activities: readonly ThreadActivityEvent[];
  readonly now?: string;
  readonly stallAfterSeconds?: number;
  readonly loopFailureThreshold?: number;
}

function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Pulse timestamps must be valid ISO timestamps.");
  }
  return parsed;
}

function ordered<T extends { readonly occurredAt: string }>(
  values: readonly T[]
): readonly T[] {
  return [...values].sort(
    (left, right) => time(left.occurredAt) - time(right.occurredAt)
  );
}

function latestCheckpoint(
  checkpoints: readonly ThreadCheckpoint[]
): ThreadCheckpoint | undefined {
  return [...checkpoints].sort(
    (left, right) => time(right.publishedAt) - time(left.publishedAt)
  )[0];
}

function failureRun(
  activities: readonly ThreadActivityEvent[]
): { readonly signature?: string; readonly count: number } {
  let signature: string | undefined;
  let count = 0;

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]!;
    if (
      activity.kind === "meaningful_progress" ||
      activity.kind === "tool_success" ||
      activity.kind === "checkpoint"
    ) {
      break;
    }
    if (activity.kind !== "tool_failure" || !activity.signature) continue;

    if (signature === undefined) {
      signature = activity.signature;
      count = 1;
      continue;
    }
    if (activity.signature !== signature) break;
    count += 1;
  }

  return { ...(signature ? { signature } : {}), count };
}

export function derivePulseStatus(
  input: PulseEvaluationInput
): PulseProjection {
  const activities = ordered(input.activities);
  const latest = activities.at(-1);
  const checkpoint = latestCheckpoint(input.checkpoints);
  const now = time(input.now ?? new Date().toISOString());
  const stallAfterSeconds = input.stallAfterSeconds ?? 900;
  const loopFailureThreshold = input.loopFailureThreshold ?? 3;

  const base = {
    threadId: input.thread.threadId,
    accountDomainId: input.thread.accountDomainId,
    ...(latest ? { lastActivityAt: latest.occurredAt } : {}),
    ...(checkpoint ? { latestCheckpointId: checkpoint.checkpointId } : {})
  };

  if (latest?.kind === "completed" || input.thread.lifecycle === "completed") {
    return Object.freeze({
      ...base,
      status: "completed",
      reason: "Thread reported completion."
    });
  }
  if (latest?.kind === "stopped") {
    return Object.freeze({
      ...base,
      status: "stopped",
      reason: "Thread/runtime reported stopped."
    });
  }
  if (
    latest?.kind === "owner_gate" ||
    checkpoint?.gate === "owner" ||
    input.thread.lifecycle === "waiting_owner"
  ) {
    return Object.freeze({
      ...base,
      status: "needs_you",
      reason: checkpoint?.gate === "owner"
        ? "Latest checkpoint requires owner attention."
        : "Thread reached an owner gate."
    });
  }
  if (latest?.kind === "blocked" || checkpoint?.gate === "blocked") {
    return Object.freeze({
      ...base,
      status: "blocked",
      reason: checkpoint?.blocker ?? latest?.summary ?? "Thread is explicitly blocked."
    });
  }

  const failures = failureRun(activities);
  if (failures.count >= loopFailureThreshold) {
    return Object.freeze({
      ...base,
      status: "possible_loop",
      reason:
        "Repeated failure signature without intervening meaningful progress.",
      repeatedFailureCount: failures.count
    });
  }

  if (
    latest?.kind === "waiting" ||
    checkpoint?.gate === "waiting_external"
  ) {
    return Object.freeze({
      ...base,
      status: "waiting",
      reason: "Thread is intentionally waiting on an external condition."
    });
  }

  if (
    latest &&
    input.thread.lifecycle === "active" &&
    now - time(latest.occurredAt) > stallAfterSeconds * 1000
  ) {
    return Object.freeze({
      ...base,
      status: "stalled",
      reason: "No observable thread activity within the configured stall window."
    });
  }

  if (
    latest &&
    (
      latest.kind === "meaningful_progress" ||
      latest.kind === "tool_success" ||
      latest.kind === "checkpoint" ||
      latest.kind === "heartbeat" ||
      latest.kind === "tool_failure"
    )
  ) {
    return Object.freeze({
      ...base,
      status: "working",
      reason: "Recent observable activity is present."
    });
  }

  return Object.freeze({
    ...base,
    status: "idle",
    reason: "No active work signal is available."
  });
}
