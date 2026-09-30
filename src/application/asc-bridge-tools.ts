import type {
  PulseProjection,
  SteeringReference,
  ThreadActivityKind,
  ThreadGate
} from "../domain/index.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";
import {
  PersistentProjectMembershipRegistry
} from "./project-membership-registry.js";
import { BridgedThreadService } from "./bridged-thread-service.js";

export interface BridgeToolCaller {
  readonly principalId: string;
  readonly source: string;
}

export interface BridgeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export class BridgeToolAuthorizationError extends Error {
  readonly code = "bridge_tool_authorization_failed";

  constructor(message: string) {
    super(message);
    this.name = "BridgeToolAuthorizationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  required = true
): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(label + " is required.");
    return undefined;
  }
  if (typeof value !== "string") throw new Error(label + " must be a string.");
  const normalized = value.trim();
  if (!normalized && required) throw new Error(label + " is required.");
  return normalized || undefined;
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(label + " must be an array of strings.");
  }
  return Object.freeze(
    [...new Set(value.map((item) => item.trim()).filter(Boolean))]
  );
}

const PUBLISHABLE_ACTIVITY_KINDS = new Set<ThreadActivityKind>([
  "meaningful_progress",
  "tool_success",
  "tool_failure",
  "heartbeat",
  "waiting",
  "owner_gate",
  "blocked",
  "completed",
  "stopped"
]);

function steering(value: unknown): SteeringReference | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  const actor = stringValue(input.actor, "lastSteering.actor")!;
  if (
    actor !== "owner" &&
    actor !== "owner_assisted" &&
    actor !== "founder_relay"
  ) {
    throw new Error("Unsupported steering actor.");
  }
  return Object.freeze({
    actor,
    text: stringValue(input.text, "lastSteering.text")!,
    ...(stringValue(input.principalId, "lastSteering.principalId", false)
      ? { principalId: stringValue(input.principalId, "lastSteering.principalId", false)! }
      : {}),
    ...(stringValue(input.messageRef, "lastSteering.messageRef", false)
      ? { messageRef: stringValue(input.messageRef, "lastSteering.messageRef", false)! }
      : {})
  });
}

export const ASC_BRIDGE_TOOL_DEFINITIONS: readonly BridgeToolDefinition[] =
  Object.freeze([
    {
      name: "thread.register_external",
      description:
        "Register an external or bridged conversation as a durable ASC Thread.",
      inputSchema: {
        type: "object",
        required: ["title", "provider"],
        properties: {
          title: { type: "string" },
          purpose: { type: "string" },
          projectId: { type: "string" },
          mode: { type: "string", enum: ["external", "bridged"] },
          provider: { type: "string" },
          externalThreadId: { type: "string" },
          navigationUrl: { type: "string" }
        },
        additionalProperties: false
      }
    },
    {
      name: "thread.publish_checkpoint",
      description:
        "Publish a structured synopsis/gate/evidence checkpoint into a bridged ASC Thread.",
      inputSchema: {
        type: "object",
        required: ["threadId", "synopsis"],
        properties: {
          threadId: { type: "string" },
          synopsis: { type: "string" },
          gate: {
            type: "string",
            enum: ["none", "owner", "blocked", "waiting_external"]
          },
          blocker: { type: "string" },
          workReferences: { type: "array", items: { type: "string" } },
          evidenceReferences: { type: "array", items: { type: "string" } },
          lastSteering: { type: "object" }
        },
        additionalProperties: false
      }
    },
    {
      name: "thread.publish_activity",
      description:
        "Publish a real runtime/tool/checkpoint activity used by ASC Pulse.",
      inputSchema: {
        type: "object",
        required: ["threadId", "kind"],
        properties: {
          threadId: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "meaningful_progress",
              "tool_success",
              "tool_failure",
              "heartbeat",
              "waiting",
              "owner_gate",
              "blocked",
              "completed",
              "stopped"
            ]
          },
          signature: { type: "string" },
          summary: { type: "string" },
          evidenceReference: { type: "string" }
        },
        additionalProperties: false
      }
    },
    {
      name: "thread.refine_synopsis",
      description:
        "Create an owner-refined synopsis checkpoint without rewriting history.",
      inputSchema: {
        type: "object",
        required: ["threadId", "checkpointId", "synopsis"],
        properties: {
          threadId: { type: "string" },
          checkpointId: { type: "string" },
          synopsis: { type: "string" }
        },
        additionalProperties: false
      }
    },
    {
      name: "thread.get",
      description: "Read one ASC Thread with checkpoints and activities.",
      inputSchema: {
        type: "object",
        required: ["threadId"],
        properties: { threadId: { type: "string" } },
        additionalProperties: false
      }
    },
    {
      name: "thread.list_pulse",
      description: "List normalized ASC Pulse projections visible through the caller's ProjectMemberships.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  ]);

export class AscBridgeToolService {
  readonly #bridge: BridgedThreadService;
  readonly #identities: PersistentIdentityRegistry;
  readonly #projectMemberships:
    PersistentProjectMembershipRegistry;
  readonly #accountDomainId: string;

  constructor(input: {
    readonly bridge: BridgedThreadService;
    readonly identities: PersistentIdentityRegistry;
    readonly projectMemberships:
      PersistentProjectMembershipRegistry;
    readonly accountDomainId: string;
  }) {
    this.#bridge = input.bridge;
    this.#identities = input.identities;
    this.#projectMemberships =
      input.projectMemberships;
    this.#accountDomainId = input.accountDomainId;
  }

  async #membership(caller: BridgeToolCaller) {
    return this.#identities.assertActiveMembership(
      caller.principalId,
      this.#accountDomainId
    );
  }

  async #assertHuman(caller: BridgeToolCaller): Promise<void> {
    await this.#membership(caller);
    const principal =
      await this.#identities.getPrincipal(
        caller.principalId
      );
    if (!principal || principal.kind !== "human") {
      throw new BridgeToolAuthorizationError(
        "Synopsis refinement requires a human Principal."
      );
    }
  }

  async #assertUnboundThreadAuthority(
    caller: BridgeToolCaller
  ): Promise<void> {
    const membership = await this.#membership(caller);
    if (
      !membership.roles.some(
        (role) =>
          role === "owner" ||
          role === "admin"
      )
    ) {
      throw new BridgeToolAuthorizationError(
        "Thread is unavailable."
      );
    }
  }

  async #assertProjectAuthority(
    caller: BridgeToolCaller,
    projectId: string,
    effectClass: "read" | "mutate"
  ): Promise<void> {
    try {
      await this.#projectMemberships
        .assertProjectAccess(
          caller.principalId,
          projectId,
          effectClass
        );
    } catch {
      throw new BridgeToolAuthorizationError(
        "Thread is unavailable."
      );
    }
  }

  async #authorizedThread(
    caller: BridgeToolCaller,
    threadId: string,
    effectClass: "read" | "mutate"
  ) {
    await this.#membership(caller);
    const snapshot =
      await this.#bridge.getThread(threadId);
    if (!snapshot) return undefined;

    if (snapshot.thread.projectId) {
      await this.#assertProjectAuthority(
        caller,
        snapshot.thread.projectId,
        effectClass
      );
    } else {
      await this.#assertUnboundThreadAuthority(
        caller
      );
    }
    return snapshot;
  }

  async #visiblePulse(
    caller: BridgeToolCaller
  ): Promise<readonly PulseProjection[]> {
    const membership = await this.#membership(caller);
    const admin = membership.roles.some(
      (role) =>
        role === "owner" ||
        role === "admin"
    );
    const accessible =
      new Set(
        (
          await this.#projectMemberships
            .listAccessibleProjects(
              caller.principalId
            )
        ).map((project) => project.projectId)
      );
    const pulses = await this.#bridge.listPulse();
    const visible: PulseProjection[] = [];

    for (const pulse of pulses) {
      const snapshot =
        await this.#bridge.getThread(
          pulse.threadId
        );
      if (!snapshot) continue;
      if (
        snapshot.thread.projectId
          ? accessible.has(
              snapshot.thread.projectId
            )
          : admin
      ) {
        visible.push(pulse);
      }
    }
    return Object.freeze(visible);
  }

  async #validateSteering(
    caller: BridgeToolCaller,
    value: SteeringReference | undefined
  ): Promise<void> {
    if (!value) return;

    if (
      value.actor === "owner" ||
      value.actor === "owner_assisted"
    ) {
      if (value.principalId !== caller.principalId) {
        throw new BridgeToolAuthorizationError(
          "Owner-authored steering must match the authenticated caller Principal."
        );
      }
      const principal = await this.#identities.getPrincipal(caller.principalId);
      if (!principal || principal.kind !== "human") {
        throw new BridgeToolAuthorizationError(
          "Owner-authored steering requires a human Principal."
        );
      }
      return;
    }

    // Founder Relay auto-send policy is not implemented yet. Keep the internal
    // provenance model, but do not let an arbitrary bridge publisher impersonate it.
    throw new BridgeToolAuthorizationError(
      "Founder Relay publication requires a future Relay authorization policy."
    );
  }

  async call(
    name: string,
    argsValue: unknown,
    caller: BridgeToolCaller
  ): Promise<unknown> {
    const args = record(argsValue);

    if (name === "thread.list_pulse") {
      return this.#visiblePulse(caller);
    }

    if (name === "thread.get") {
      return this.#authorizedThread(
        caller,
        stringValue(args.threadId, "threadId")!,
        "read"
      );
    }

    if (name === "thread.register_external") {
      await this.#membership(caller);
      const modeValue = stringValue(args.mode, "mode", false);
      if (
        modeValue !== undefined &&
        modeValue !== "external" &&
        modeValue !== "bridged"
      ) {
        throw new Error("mode must be external or bridged.");
      }

      const projectId =
        stringValue(
          args.projectId,
          "projectId",
          false
        );
      if (projectId) {
        await this.#assertProjectAuthority(
          caller,
          projectId,
          "mutate"
        );
      } else {
        await this.#assertUnboundThreadAuthority(
          caller
        );
      }

      return this.#bridge.registerExternal({
        title: stringValue(args.title, "title")!,
        provider: stringValue(args.provider, "provider")!,
        ...(stringValue(args.purpose, "purpose", false)
          ? { purpose: stringValue(args.purpose, "purpose", false)! }
          : {}),
        ...(projectId ? { projectId } : {}),
        ...(modeValue ? { mode: modeValue } : {}),
        ...(stringValue(args.externalThreadId, "externalThreadId", false)
          ? {
              externalThreadId: stringValue(
                args.externalThreadId,
                "externalThreadId",
                false
              )!
            }
          : {}),
        ...(stringValue(args.navigationUrl, "navigationUrl", false)
          ? {
              navigationUrl: stringValue(
                args.navigationUrl,
                "navigationUrl",
                false
              )!
            }
          : {})
      });
    }

    if (name === "thread.publish_checkpoint") {
      const threadId =
        stringValue(args.threadId, "threadId")!;
      await this.#authorizedThread(
        caller,
        threadId,
        "mutate"
      );
      const lastSteering = steering(args.lastSteering);
      await this.#validateSteering(caller, lastSteering);

      const gateValue = stringValue(args.gate, "gate", false) ?? "none";
      if (
        gateValue !== "none" &&
        gateValue !== "owner" &&
        gateValue !== "blocked" &&
        gateValue !== "waiting_external"
      ) {
        throw new Error("Unsupported checkpoint gate.");
      }

      return this.#bridge.publishCheckpoint({
        threadId,
        synopsis: stringValue(args.synopsis, "synopsis")!,
        gate: gateValue as ThreadGate,
        ...(stringValue(args.blocker, "blocker", false)
          ? { blocker: stringValue(args.blocker, "blocker", false)! }
          : {}),
        workReferences: stringArray(args.workReferences, "workReferences"),
        evidenceReferences: stringArray(
          args.evidenceReferences,
          "evidenceReferences"
        ),
        publishedByPrincipalId: caller.principalId,
        ...(lastSteering ? { lastSteering } : {})
      });
    }

    if (name === "thread.publish_activity") {
      const threadId =
        stringValue(args.threadId, "threadId")!;
      await this.#authorizedThread(
        caller,
        threadId,
        "mutate"
      );
      const kindValue = stringValue(args.kind, "kind")!;
      if (!PUBLISHABLE_ACTIVITY_KINDS.has(kindValue as ThreadActivityKind)) {
        throw new Error("Unsupported activity kind.");
      }
      const kind = kindValue as ThreadActivityKind;
      return this.#bridge.recordActivity({
        threadId,
        kind,
        source: caller.source,
        ...(stringValue(args.signature, "signature", false)
          ? { signature: stringValue(args.signature, "signature", false)! }
          : {}),
        ...(stringValue(args.summary, "summary", false)
          ? { summary: stringValue(args.summary, "summary", false)! }
          : {}),
        ...(stringValue(args.evidenceReference, "evidenceReference", false)
          ? {
              evidenceReference: stringValue(
                args.evidenceReference,
                "evidenceReference",
                false
              )!
            }
          : {}),
        publishedByPrincipalId: caller.principalId
      });
    }

    if (name === "thread.refine_synopsis") {
      await this.#assertHuman(caller);
      const threadId =
        stringValue(args.threadId, "threadId")!;
      await this.#authorizedThread(
        caller,
        threadId,
        "mutate"
      );
      return this.#bridge.refineSynopsis({
        threadId,
        checkpointId: stringValue(args.checkpointId, "checkpointId")!,
        synopsis: stringValue(args.synopsis, "synopsis")!,
        principalId: caller.principalId
      });
    }

    throw new Error("Unknown ASC bridge tool: " + name);
  }

  async listPulse(caller: BridgeToolCaller): Promise<readonly PulseProjection[]> {
    return this.call("thread.list_pulse", {}, caller) as Promise<
      readonly PulseProjection[]
    >;
  }
}
