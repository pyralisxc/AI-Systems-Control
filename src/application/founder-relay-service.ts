import { randomUUID } from "node:crypto";

import type {
  EffectClass,
  FounderRelayProposalMode,
  FounderRelayRecord,
  RepositoryBoundary,
  ThreadActivityEvent
} from "../domain/index.js";
import {
  ThreadRevisionConflictError,
  type FounderRelayDeliveryPort,
  type ThreadSnapshot,
  type ThreadStore
} from "../ports/index.js";
import { ContinuationAuthorityService } from "./continuation-authority-service.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";

export interface ProposeFounderRelayInput {
  readonly threadId: string;
  readonly representedPrincipalId: string;
  readonly generatedByPrincipalId: string;
  readonly proposalMode?: FounderRelayProposalMode;
  readonly proposedText: string;
  readonly workClass: string;
  readonly requestedEffect: EffectClass;
  readonly requestedRepositoryBoundary: RepositoryBoundary;
  readonly capabilityId?: string;
  readonly sourceReferences?: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly generatedAt?: string;
}

export interface RelayFeedbackInput {
  readonly threadId: string;
  readonly relayId: string;
  readonly principalId: string;
  readonly action: "approve" | "edit" | "reject";
  readonly editedText?: string;
  readonly feedbackAt?: string;
}

export interface AutoSendRelayResult {
  readonly sent: boolean;
  readonly reason: string;
  readonly relay: FounderRelayRecord;
}

export class FounderRelayError extends Error {
  readonly code = "founder_relay_failed";

  constructor(message: string) {
    super(message);
    this.name = "FounderRelayError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new FounderRelayError(label + " is required.");
  return normalized;
}

function unique(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))
  ]);
}

function activity(input: {
  readonly threadId: string;
  readonly accountDomainId: string;
  readonly occurredAt: string;
  readonly kind: ThreadActivityEvent["kind"];
  readonly source: string;
  readonly summary: string;
  readonly principalId?: string;
}): ThreadActivityEvent {
  return Object.freeze({
    activityId: "activity:" + randomUUID(),
    threadId: input.threadId,
    accountDomainId: input.accountDomainId,
    occurredAt: input.occurredAt,
    kind: input.kind,
    source: input.source,
    summary: input.summary,
    ...(input.principalId
      ? { publishedByPrincipalId: input.principalId }
      : {})
  });
}

function replaceRelay(
  relays: readonly FounderRelayRecord[],
  relay: FounderRelayRecord
): readonly FounderRelayRecord[] {
  return Object.freeze(
    relays.map((candidate) =>
      candidate.relayId === relay.relayId ? relay : candidate
    )
  );
}

export class FounderRelayService {
  readonly #store: ThreadStore;
  readonly #identities: PersistentIdentityRegistry;
  readonly #continuation: ContinuationAuthorityService;
  readonly #delivery: FounderRelayDeliveryPort | undefined;

  constructor(input: {
    readonly threadStore: ThreadStore;
    readonly identities: PersistentIdentityRegistry;
    readonly continuation: ContinuationAuthorityService;
    readonly delivery?: FounderRelayDeliveryPort;
  }) {
    this.#store = input.threadStore;
    this.#identities = input.identities;
    this.#continuation = input.continuation;
    this.#delivery = input.delivery;
  }

  async #assertGenerator(principalId: string): Promise<void> {
    const principal = await this.#identities.getPrincipal(principalId);
    if (!principal || principal.status !== "active" || principal.kind !== "service") {
      throw new FounderRelayError(
        "Founder Relay generation requires an active service Principal."
      );
    }
    const membership = await this.#identities.assertActiveMembership(
      principalId,
      this.#store.accountDomainId
    );
    if (
      !membership.roles.some((role) =>
        role === "operator" || role === "admin" || role === "owner"
      )
    ) {
      throw new FounderRelayError(
        "Generating service Principal lacks operator authority."
      );
    }
  }

  async #assertRepresentedHuman(principalId: string): Promise<void> {
    const principal = await this.#identities.getPrincipal(principalId);
    if (!principal || principal.status !== "active" || principal.kind !== "human") {
      throw new FounderRelayError(
        "Founder Relay must represent an active human Principal."
      );
    }
    try {
      await this.#identities.assertPrincipalCanAdministerDomain(
        principalId,
        this.#store.accountDomainId
      );
    } catch {
      throw new FounderRelayError(
        "Represented Principal lacks active owner/admin authority in this AccountDomain."
      );
    }
  }

  async #mutate(
    threadId: string,
    mutate: (snapshot: ThreadSnapshot) => {
      readonly thread: ThreadSnapshot["thread"];
      readonly checkpoints: ThreadSnapshot["checkpoints"];
      readonly activities: ThreadSnapshot["activities"];
      readonly relays: ThreadSnapshot["relays"];
    },
    maxAttempts = 5
  ): Promise<ThreadSnapshot> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const snapshot = await this.#store.load(threadId);
      if (!snapshot) throw new FounderRelayError("Unknown Thread: " + threadId);
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
    throw new FounderRelayError("Relay mutation exhausted retry budget.");
  }

  async propose(
    input: ProposeFounderRelayInput
  ): Promise<FounderRelayRecord> {
    await this.#assertGenerator(input.generatedByPrincipalId);
    await this.#assertRepresentedHuman(input.representedPrincipalId);

    const snapshot = await this.#store.load(input.threadId);
    if (!snapshot) throw new FounderRelayError("Unknown Thread: " + input.threadId);
    if (!snapshot.thread.projectId) {
      throw new FounderRelayError(
        "Founder Relay requires a Project-scoped Thread."
      );
    }

    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const proposalMode = input.proposalMode ?? "suggest";
    const evaluation = await this.#continuation.evaluate({
      projectId: snapshot.thread.projectId,
      threadId: snapshot.thread.threadId,
      workClass: required(input.workClass, "Work class"),
      requestedEffect: input.requestedEffect,
      requestedRepositoryBoundary: input.requestedRepositoryBoundary,
      ...(input.capabilityId
        ? { capabilityId: input.capabilityId }
        : {}),
      now: generatedAt
    });

    const relay: FounderRelayRecord = Object.freeze({
      relayId: "relay:" + randomUUID(),
      threadId: snapshot.thread.threadId,
      accountDomainId: this.#store.accountDomainId,
      projectId: snapshot.thread.projectId,
      representedPrincipalId: input.representedPrincipalId,
      generatedByPrincipalId: input.generatedByPrincipalId,
      proposalMode,
      proposedText: required(input.proposedText, "Relay text"),
      workClass: required(input.workClass, "Work class"),
      requestedEffect: input.requestedEffect,
      requestedRepositoryBoundary: input.requestedRepositoryBoundary,
      ...(input.capabilityId
        ? { capabilityId: input.capabilityId }
        : {}),
      sourceReferences: unique(input.sourceReferences),
      evidenceReferences: unique(input.evidenceReferences),
      generatedAt,
      proposalAuthority: evaluation,
      state: "suggested"
    });

    await this.#mutate(input.threadId, (current) => {
      if (
        current.thread.projectId !== relay.projectId
      ) {
        throw new FounderRelayError(
          "Thread Project changed while Relay was being proposed."
        );
      }

      const needsOwner =
        proposalMode === "suggest" ||
        evaluation.decision !== "allow";
      const nextActivity = activity({
        threadId: current.thread.threadId,
        accountDomainId: this.#store.accountDomainId,
        occurredAt: generatedAt,
        kind: needsOwner ? "owner_gate" : "meaningful_progress",
        source: "founder-relay",
        summary: needsOwner
          ? "Founder Relay suggestion is waiting for owner review."
          : "Founder Relay auto-send candidate generated.",
        principalId: input.generatedByPrincipalId
      });

      return {
        thread: Object.freeze({
          ...current.thread,
          lifecycle: needsOwner ? "waiting_owner" : current.thread.lifecycle,
          updatedAt: generatedAt
        }),
        checkpoints: current.checkpoints,
        activities: [...current.activities, nextActivity],
        relays: [...current.relays, relay]
      };
    });

    return relay;
  }

  async feedback(
    input: RelayFeedbackInput
  ): Promise<FounderRelayRecord> {
    await this.#assertRepresentedHuman(input.principalId);
    const feedbackAt = input.feedbackAt ?? new Date().toISOString();
    let updatedRelay: FounderRelayRecord | undefined;

    await this.#mutate(input.threadId, (snapshot) => {
      const relay = snapshot.relays.find(
        (candidate) => candidate.relayId === input.relayId
      );
      if (!relay) throw new FounderRelayError("Unknown Founder Relay.");
      if (relay.state !== "suggested") {
        throw new FounderRelayError(
          "Founder Relay is no longer awaiting owner feedback."
        );
      }
      if (relay.representedPrincipalId !== input.principalId) {
        throw new FounderRelayError(
          "Only the represented human Principal may approve, edit, or reject this Relay."
        );
      }

      if (input.action === "edit" && !input.editedText?.trim()) {
        throw new FounderRelayError(
          "Edited Relay feedback requires non-empty text."
        );
      }

      updatedRelay = Object.freeze({
        ...relay,
        state:
          input.action === "approve"
            ? "owner_approved"
            : input.action === "edit"
              ? "edited"
              : "rejected",
        ...(input.action === "approve"
          ? { finalText: relay.proposedText }
          : input.action === "edit"
            ? { finalText: input.editedText!.trim() }
            : {}),
        ownerFeedbackPrincipalId: input.principalId,
        feedbackAt
      });

      const relays = replaceRelay(snapshot.relays, updatedRelay);
      const stillWaiting = relays.some(
        (candidate) =>
          candidate.state === "suggested" &&
          candidate.proposalMode === "suggest"
      );

      return {
        thread: Object.freeze({
          ...snapshot.thread,
          lifecycle:
            snapshot.thread.lifecycle === "completed" ||
            snapshot.thread.lifecycle === "archived"
              ? snapshot.thread.lifecycle
              : stillWaiting
                ? "waiting_owner"
                : "active",
          updatedAt: feedbackAt
        }),
        checkpoints: snapshot.checkpoints,
        activities: [
          ...snapshot.activities,
          activity({
            threadId: snapshot.thread.threadId,
            accountDomainId: this.#store.accountDomainId,
            occurredAt: feedbackAt,
            kind: "meaningful_progress",
            source: "founder-relay-feedback",
            summary:
              input.action === "reject"
                ? "Owner rejected Founder Relay suggestion."
                : "Owner reviewed Founder Relay suggestion.",
            principalId: input.principalId
          })
        ],
        relays
      };
    });

    return updatedRelay!;
  }

  async autoSend(
    input: {
      readonly threadId: string;
      readonly relayId: string;
      readonly now?: string;
    }
  ): Promise<AutoSendRelayResult> {
    const snapshot = await this.#store.load(input.threadId);
    if (!snapshot) throw new FounderRelayError("Unknown Thread: " + input.threadId);
    const relay = snapshot.relays.find(
      (candidate) => candidate.relayId === input.relayId
    );
    if (!relay) throw new FounderRelayError("Unknown Founder Relay.");

    if (relay.state === "auto_sent") {
      return Object.freeze({
        sent: true,
        reason: "Founder Relay was already delivered.",
        relay
      });
    }
    if (relay.state !== "suggested" || relay.proposalMode !== "auto_candidate") {
      throw new FounderRelayError(
        "Only an unsent auto-candidate Relay may be auto-sent."
      );
    }

    const now = input.now ?? new Date().toISOString();
    const evaluation = await this.#continuation.evaluate({
      projectId: relay.projectId,
      threadId: relay.threadId,
      workClass: relay.workClass,
      requestedEffect: relay.requestedEffect,
      requestedRepositoryBoundary: relay.requestedRepositoryBoundary,
      ...(relay.capabilityId ? { capabilityId: relay.capabilityId } : {}),
      now
    });

    if (evaluation.decision !== "allow") {
      let persisted: FounderRelayRecord | undefined;
      await this.#mutate(input.threadId, (current) => {
        const currentRelay = current.relays.find(
          (candidate) => candidate.relayId === relay.relayId
        );
        if (!currentRelay || currentRelay.state !== "suggested") {
          throw new FounderRelayError(
            "Founder Relay state changed before authority re-evaluation was recorded."
          );
        }
        persisted = Object.freeze({
          ...currentRelay,
          deliveryAuthority: evaluation
        });
        return {
          thread: Object.freeze({
            ...current.thread,
            lifecycle: "waiting_owner",
            updatedAt: now
          }),
          checkpoints: current.checkpoints,
          activities: [
            ...current.activities,
            activity({
              threadId: current.thread.threadId,
              accountDomainId: this.#store.accountDomainId,
              occurredAt: now,
              kind: "owner_gate",
              source: "founder-relay",
              summary:
                "Founder Relay auto-send is not currently authorized.",
              principalId: currentRelay.generatedByPrincipalId
            })
          ],
          relays: replaceRelay(current.relays, persisted)
        };
      });

      return Object.freeze({
        sent: false,
        reason: evaluation.reason,
        relay: persisted!
      });
    }

    if (
      !snapshot.thread.runtimeCapabilities.canAutoSendRelay ||
      !this.#delivery ||
      !this.#delivery.canDeliver(snapshot.thread)
    ) {
      let persisted: FounderRelayRecord | undefined;
      await this.#mutate(input.threadId, (current) => {
        const currentRelay = current.relays.find(
          (candidate) => candidate.relayId === relay.relayId
        );
        if (!currentRelay || currentRelay.state !== "suggested") {
          throw new FounderRelayError(
            "Founder Relay state changed before transport limitation was recorded."
          );
        }
        persisted = Object.freeze({
          ...currentRelay,
          deliveryAuthority: evaluation
        });
        return {
          thread: Object.freeze({
            ...current.thread,
            lifecycle: "waiting_owner",
            updatedAt: now
          }),
          checkpoints: current.checkpoints,
          activities: [
            ...current.activities,
            activity({
              threadId: current.thread.threadId,
              accountDomainId: this.#store.accountDomainId,
              occurredAt: now,
              kind: "owner_gate",
              source: "founder-relay",
              summary:
                "Founder Relay is authorized, but this Thread transport requires manual owner delivery.",
              principalId: currentRelay.generatedByPrincipalId
            })
          ],
          relays: replaceRelay(current.relays, persisted)
        };
      });

      return Object.freeze({
        sent: false,
        reason:
          "Current Thread transport cannot deliver Founder Relay automatically.",
        relay: persisted!
      });
    }

    const delivered = await this.#delivery.deliver({
      relayId: relay.relayId,
      thread: snapshot.thread,
      text: relay.proposedText,
      representedPrincipalId: relay.representedPrincipalId
    });

    let sentRelay: FounderRelayRecord | undefined;
    await this.#mutate(input.threadId, (current) => {
      const currentRelay = current.relays.find(
        (candidate) => candidate.relayId === relay.relayId
      );
      if (!currentRelay) {
        throw new FounderRelayError(
          "Founder Relay disappeared after delivery."
        );
      }
      if (currentRelay.state === "auto_sent") {
        sentRelay = currentRelay;
        return {
          thread: current.thread,
          checkpoints: current.checkpoints,
          activities: current.activities,
          relays: current.relays
        };
      }
      if (currentRelay.state !== "suggested") {
        throw new FounderRelayError(
          "Founder Relay received owner feedback during delivery."
        );
      }

      sentRelay = Object.freeze({
        ...currentRelay,
        finalText: currentRelay.proposedText,
        deliveryAuthority: evaluation,
        state: "auto_sent",
        deliveredAt: delivered.deliveredAt,
        ...(delivered.deliveryRef
          ? { deliveryRef: delivered.deliveryRef }
          : {})
      });

      return {
        thread: Object.freeze({
          ...current.thread,
          lifecycle:
            current.thread.lifecycle === "completed" ||
            current.thread.lifecycle === "archived"
              ? current.thread.lifecycle
              : "active",
          updatedAt: delivered.deliveredAt
        }),
        checkpoints: current.checkpoints,
        activities: [
          ...current.activities,
          activity({
            threadId: current.thread.threadId,
            accountDomainId: this.#store.accountDomainId,
            occurredAt: delivered.deliveredAt,
            kind: "meaningful_progress",
            source: "founder-relay-delivery",
            summary: "Founder Relay delivered through managed transport.",
            principalId: currentRelay.generatedByPrincipalId
          })
        ],
        relays: replaceRelay(current.relays, sentRelay)
      };
    });

    return Object.freeze({
      sent: true,
      reason: "Founder Relay was delivered under current continuation authority.",
      relay: sentRelay!
    });
  }
}
