import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  DelegationRecord,
  DelegationUseReceipt,
  EffectClass,
  ProjectConnectionBinding
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";
import {
  InMemoryProjectConnectionBindingRegistry,
  type ResolveProjectConnectionInput
} from "./project-connection-binding-registry.js";

export interface IssueDelegationInput extends ResolveProjectConnectionInput {
  readonly effectClass: EffectClass;
  readonly audience: string;
  readonly approvalReference?: string;
  readonly expiresInSeconds?: number;
  readonly issuedAt?: string;
}

export interface IssuedDelegation {
  readonly handle: string;
  readonly delegationId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly expiresAt: string;
}

export interface ConsumeDelegationInput {
  readonly audience: string;
  readonly projectId: string;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly workspaceId?: string;
  readonly environment?: string;
  readonly now?: string;
}

export class DelegationValidationError extends Error {
  readonly code = "delegation_validation_failed";

  constructor(message: string) {
    super(message);
    this.name = "DelegationValidationError";
  }
}

function hashHandle(handle: string): string {
  return createHash("sha256").update(handle).digest("hex");
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function withoutStateTimestamps(record: DelegationRecord): DelegationRecord {
  const { consumedAt: _consumedAt, revokedAt: _revokedAt, ...rest } = record;
  return rest;
}

function freezeRecord(record: DelegationRecord): DelegationRecord {
  return Object.freeze({
    ...record,
    ...(record.resource ? { resource: Object.freeze({ ...record.resource }) } : {})
  });
}

function approvalRequired(binding: ProjectConnectionBinding, effectClass: EffectClass): boolean {
  return binding.approvalRequiredFor.includes(effectClass);
}

function isoAfter(issuedAt: string, seconds: number): string {
  const start = Date.parse(issuedAt);
  if (!Number.isFinite(start)) throw new Error("Delegation issuedAt must be a valid ISO timestamp.");
  return new Date(start + seconds * 1000).toISOString();
}

function optionalMatch(left: string | undefined, right: string | undefined): boolean {
  return normalizeOptional(left) === normalizeOptional(right);
}

export class DelegationService {
  readonly #store: ControlRegistryStore;

  constructor(store: ControlRegistryStore) {
    this.#store = store;
  }

  async issue(input: IssueDelegationInput): Promise<IssuedDelegation> {
    const audience = input.audience.trim();
    if (!audience) throw new DelegationValidationError("Delegation audience is required.");

    const ttl = input.expiresInSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
      throw new DelegationValidationError("Delegation TTL must be between 1 and 3600 seconds.");
    }

    return mutateControlRegistry(this.#store, (snapshot) => {
      const projectRecord = snapshot.projects.find(
        (candidate) => candidate.projectId === input.projectId
      );
      if (!projectRecord) {
        throw new DelegationValidationError("Unknown project: " + input.projectId);
      }
      if (!projectRecord.accountDomainId) {
        throw new DelegationValidationError(
          "Project " + input.projectId + " has no AccountDomain assignment."
        );
      }

      const connections = snapshot.connections.filter(
        (connection) => connection.accountDomainId === projectRecord.accountDomainId
      );
      const resolver = new InMemoryProjectConnectionBindingRegistry(
        snapshot.projectConnectionBindings
      );
      const resolution = resolver.resolve(input, connections);
      if (resolution.status !== "available" || !resolution.binding || !resolution.connection) {
        throw new DelegationValidationError(
          resolution.reason ?? "Connection resolution failed with " + resolution.status + "."
        );
      }

      if (approvalRequired(resolution.binding, input.effectClass) && !input.approvalReference?.trim()) {
        throw new DelegationValidationError(
          "Effect class " + input.effectClass +
          " requires an approval reference for binding " + resolution.binding.bindingId + "."
        );
      }

      const issuedAt = input.issuedAt ?? new Date().toISOString();
      const handle = "ascd_" + randomBytes(32).toString("base64url");
      const delegationId = "delegation:" + randomUUID();
      const environment = normalizeOptional(input.environment);
      const record = freezeRecord({
        delegationId,
        handleHash: hashHandle(handle),
        bindingId: resolution.binding.bindingId,
        connectionId: resolution.connection.connectionId,
        connectionGeneration: resolution.connection.generation,
        projectId: input.projectId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        capabilityId: input.capabilityId,
        effectClass: input.effectClass,
        ...(environment ? { environment } : {}),
        ...(resolution.binding.resource ? { resource: resolution.binding.resource } : {}),
        audience,
        ...(input.approvalReference?.trim()
          ? { approvalReference: input.approvalReference.trim() }
          : {}),
        issuedAt,
        expiresAt: isoAfter(issuedAt, ttl),
        state: "active"
      });

      return {
        result: Object.freeze({
          handle,
          delegationId,
          connectionId: record.connectionId,
          bindingId: record.bindingId,
          expiresAt: record.expiresAt
        }),
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: Object.freeze([...snapshot.delegations, record]),
        changed: true
      };
    });
  }

  async consume(handle: string, input: ConsumeDelegationInput): Promise<DelegationUseReceipt> {
    const digest = hashHandle(handle);
    const now = input.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new DelegationValidationError("Consume time must be valid ISO.");

    return mutateControlRegistry(this.#store, (snapshot) => {
      const index = snapshot.delegations.findIndex((record) => record.handleHash === digest);
      if (index < 0) throw new DelegationValidationError("Unknown delegation handle.");

      const record = snapshot.delegations[index]!;
      if (record.state !== "active") {
        throw new DelegationValidationError(
          "Delegation is " + record.state + "; replay is not allowed."
        );
      }
      if (Date.parse(record.expiresAt) <= nowMs) {
        throw new DelegationValidationError("Delegation has expired.");
      }
      if (record.audience !== input.audience) {
        throw new DelegationValidationError("Delegation audience does not match caller.");
      }
      if (record.projectId !== input.projectId) {
        throw new DelegationValidationError("Delegation Project does not match caller request.");
      }
      if (record.capabilityId !== input.capabilityId) {
        throw new DelegationValidationError("Delegation capability does not match caller request.");
      }
      if (record.effectClass !== input.effectClass) {
        throw new DelegationValidationError("Delegation effect class does not match caller request.");
      }
      if (record.workspaceId !== input.workspaceId) {
        throw new DelegationValidationError("Delegation workspace does not match caller request.");
      }
      if (!optionalMatch(record.environment, input.environment)) {
        throw new DelegationValidationError("Delegation environment does not match caller request.");
      }

      const connection = snapshot.connections.find(
        (candidate) => candidate.connectionId === record.connectionId
      );
      if (!connection || connection.status !== "active") {
        throw new DelegationValidationError("Delegation connection is unavailable or revoked.");
      }
      if (connection.generation !== record.connectionGeneration) {
        throw new DelegationValidationError(
          "Delegation was issued against an older Connection generation."
        );
      }

      const consumed = freezeRecord({
        ...withoutStateTimestamps(record),
        state: "consumed",
        consumedAt: now
      });
      const delegations = [...snapshot.delegations];
      delegations[index] = consumed;

      const receipt: DelegationUseReceipt = Object.freeze({
        delegationId: record.delegationId,
        bindingId: record.bindingId,
        connectionId: record.connectionId,
        projectId: record.projectId,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        capabilityId: record.capabilityId,
        effectClass: record.effectClass,
        ...(record.environment ? { environment: record.environment } : {}),
        ...(record.resource ? { resource: record.resource } : {}),
        audience: record.audience,
        ...(record.approvalReference ? { approvalReference: record.approvalReference } : {}),
        consumedAt: now
      });

      return {
        result: receipt,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: Object.freeze(delegations),
        changed: true
      };
    });
  }

  async revoke(delegationId: string, at = new Date().toISOString()): Promise<void> {
    await mutateControlRegistry(this.#store, (snapshot) => {
      const index = snapshot.delegations.findIndex(
        (record) => record.delegationId === delegationId
      );
      if (index < 0) throw new DelegationValidationError("Unknown delegation.");

      const record = snapshot.delegations[index]!;
      if (record.state === "revoked") {
        return {
          result: undefined,
          projects: snapshot.projects,
          connections: snapshot.connections,
          projectConnectionBindings: snapshot.projectConnectionBindings,
          delegations: snapshot.delegations,
          changed: false
        };
      }

      const revoked = freezeRecord({
        ...withoutStateTimestamps(record),
        state: "revoked",
        revokedAt: at
      });
      const delegations = [...snapshot.delegations];
      delegations[index] = revoked;

      return {
        result: undefined,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: Object.freeze(delegations),
        changed: true
      };
    });
  }
}
