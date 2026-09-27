import { randomUUID } from "node:crypto";

import type {
  AutonomyGrant,
  AutonomyGrantState,
  AutonomyLevel,
  ContinuationEvaluation,
  ContinuationPolicy,
  EffectClass,
  RepositoryBoundary,
  WorkEnvelope,
  WorkAuthorization
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";

export interface CreateWorkEnvelopeInput {
  readonly projectId: string;
  readonly threadId?: string;
  readonly objectiveRef: string;
  readonly scopeFingerprint: string;
  readonly workClasses: readonly string[];
  readonly allowedEffects: readonly EffectClass[];
  readonly repositoryBoundary: RepositoryBoundary;
  readonly allowedCapabilities?: readonly string[];
  readonly continuationPolicy: ContinuationPolicy;
  readonly ownerGateConditions?: readonly string[];
  readonly budgetUsd?: number;
  readonly authorizationId?: string;
  readonly createdByPrincipalId: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
}

export interface GrantAutonomyInput {
  readonly projectId: string;
  readonly workClass: string;
  readonly level: AutonomyLevel;
  readonly repositoryCeiling: RepositoryBoundary;
  readonly grantedByPrincipalId: string;
  readonly evidenceBasisRefs: readonly string[];
  readonly lastProvenAt?: string;
  readonly reviewAfter?: string;
  readonly invalidationConditions?: readonly string[];
  readonly grantedAt?: string;
}

export interface SetAutonomyGrantStateInput {
  readonly grantId: string;
  readonly state: AutonomyGrantState;
  readonly changedByPrincipalId: string;
}

export interface EvaluateContinuationInput {
  readonly projectId: string;
  readonly threadId?: string;
  readonly workClass: string;
  readonly requestedEffect: EffectClass;
  readonly requestedRepositoryBoundary: RepositoryBoundary;
  readonly capabilityId?: string;
  readonly explicitOwnerGateReached?: boolean;
  readonly now?: string;
}

export class ContinuationAuthorityError extends Error {
  readonly code = "continuation_authority_failed";

  constructor(message: string) {
    super(message);
    this.name = "ContinuationAuthorityError";
  }
}

const BOUNDARY_RANK: Readonly<Record<RepositoryBoundary, number>> = Object.freeze({
  read_only: 0,
  work_branch: 1,
  preview: 2,
  main: 3
});

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ContinuationAuthorityError(label + " is required.");
  }
  return normalized;
}

function uniqueStrings(
  values: readonly string[],
  label: string,
  allowEmpty = false
): readonly string[] {
  const output = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!allowEmpty && output.length === 0) {
    throw new ContinuationAuthorityError(
      label + " requires at least one value."
    );
  }
  return Object.freeze(output);
}

function uniqueEffects(values: readonly EffectClass[]): readonly EffectClass[] {
  const output = [...new Set(values)];
  if (output.length === 0) {
    throw new ContinuationAuthorityError(
      "WorkEnvelope requires at least one allowed effect."
    );
  }
  return Object.freeze(output);
}

function time(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new ContinuationAuthorityError(label + " must be a valid ISO timestamp.");
  }
  return result;
}

function requiresMutableAuthorization(
  effects: readonly EffectClass[],
  boundary: RepositoryBoundary
): boolean {
  return effects.includes("mutate") || BOUNDARY_RANK[boundary] > 0;
}

function matchingAuthorization(
  authorization: WorkAuthorization | undefined,
  input: {
    readonly projectId: string;
    readonly objectiveRef: string;
    readonly scopeFingerprint: string;
  }
): boolean {
  return Boolean(
    authorization &&
    authorization.state === "active" &&
    authorization.projectId === input.projectId &&
    authorization.workReference === input.objectiveRef &&
    authorization.scopeFingerprint === input.scopeFingerprint
  );
}

function humanAdminError(message: string): ContinuationAuthorityError {
  return new ContinuationAuthorityError(message);
}

function currentControlMode(
  snapshot: Awaited<ReturnType<ControlRegistryStore["load"]>>,
  projectId: string
) {
  return snapshot.workerControl.projectControls.find(
    (control) => control.projectId === projectId
  );
}

function latestEnvelope(
  envelopes: readonly WorkEnvelope[],
  input: EvaluateContinuationInput
): WorkEnvelope | undefined {
  return [...envelopes]
    .filter((envelope) =>
      envelope.projectId === input.projectId &&
      envelope.workClasses.includes(input.workClass) &&
      (
        input.threadId
          ? envelope.threadId === input.threadId || envelope.threadId === undefined
          : envelope.threadId === undefined
      )
    )
    .sort((left, right) => {
      const leftThread = left.threadId === input.threadId ? 1 : 0;
      const rightThread = right.threadId === input.threadId ? 1 : 0;
      return (
        rightThread - leftThread ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.version - left.version
      );
    })[0];
}

function latestGrant(
  grants: readonly AutonomyGrant[],
  projectId: string,
  workClass: string
): AutonomyGrant | undefined {
  return [...grants]
    .filter((grant) =>
      grant.projectId === projectId &&
      grant.workClass === workClass
    )
    .sort((left, right) =>
      right.grantedAt.localeCompare(left.grantedAt)
    )[0];
}

function effectiveCeiling(
  envelope: WorkEnvelope,
  grant: AutonomyGrant
): RepositoryBoundary {
  return BOUNDARY_RANK[envelope.repositoryBoundary] <=
    BOUNDARY_RANK[grant.repositoryCeiling]
    ? envelope.repositoryBoundary
    : grant.repositoryCeiling;
}

export class ContinuationAuthorityService {
  readonly #store: ControlRegistryStore;
  readonly #identities: PersistentIdentityRegistry;

  constructor(
    store: ControlRegistryStore,
    identities: PersistentIdentityRegistry
  ) {
    this.#store = store;
    this.#identities = identities;
  }

  async #assertHumanAdmin(principalId: string): Promise<void> {
    const principal = await this.#identities.getPrincipal(principalId);
    if (!principal || principal.status !== "active") {
      throw humanAdminError("Principal is unavailable or inactive.");
    }
    if (principal.kind !== "human") {
      throw humanAdminError(
        "Continuation authority changes require a human Principal."
      );
    }

    let membership;
    try {
      membership = await this.#identities.assertPrincipalCanAdministerDomain(
        principalId,
        this.#store.accountDomainId
      );
    } catch {
      throw humanAdminError(
        "Principal lacks active owner/admin authority in this AccountDomain."
      );
    }
    void membership;
  }

  async createEnvelope(
    input: CreateWorkEnvelopeInput
  ): Promise<WorkEnvelope> {
    await this.#assertHumanAdmin(input.createdByPrincipalId);

    const projectId = required(input.projectId, "Project");
    const objectiveRef = required(input.objectiveRef, "Objective reference");
    const scopeFingerprint = required(
      input.scopeFingerprint,
      "Scope fingerprint"
    );
    const workClasses = uniqueStrings(input.workClasses, "Work classes");
    const allowedEffects = uniqueEffects(input.allowedEffects);
    const allowedCapabilities = uniqueStrings(
      input.allowedCapabilities ?? [],
      "Allowed capabilities",
      true
    );
    const ownerGateConditions = uniqueStrings(
      input.ownerGateConditions ?? [],
      "Owner gate conditions",
      true
    );
    const createdAt = input.createdAt ?? new Date().toISOString();
    const createdAtMs = time(createdAt, "Envelope createdAt");

    if (
      input.budgetUsd !== undefined &&
      (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0)
    ) {
      throw new ContinuationAuthorityError(
        "Envelope budget must be a non-negative number."
      );
    }
    if (
      input.expiresAt &&
      time(input.expiresAt, "Envelope expiresAt") <= createdAtMs
    ) {
      throw new ContinuationAuthorityError(
        "Envelope expiry must be after creation."
      );
    }

    return mutateControlRegistry(this.#store, (snapshot) => {
      if (!snapshot.projects.some((project) => project.projectId === projectId)) {
        throw new ContinuationAuthorityError(
          "Unknown Project: " + projectId
        );
      }

      const mutable = requiresMutableAuthorization(
        allowedEffects,
        input.repositoryBoundary
      );
      const authorization = input.authorizationId
        ? snapshot.workerControl.authorizations.find(
            (candidate) =>
              candidate.authorizationId === input.authorizationId
          )
        : undefined;

      if (
        mutable &&
        !matchingAuthorization(authorization, {
          projectId,
          objectiveRef,
          scopeFingerprint
        })
      ) {
        throw new ContinuationAuthorityError(
          "Mutable WorkEnvelope requires an active matching WorkAuthorization."
        );
      }

      const related = snapshot.continuationControl.workEnvelopes.filter(
        (envelope) =>
          envelope.projectId === projectId &&
          envelope.objectiveRef === objectiveRef &&
          envelope.threadId === input.threadId
      );
      const version = related.reduce(
        (maximum, envelope) => Math.max(maximum, envelope.version),
        0
      ) + 1;

      const envelope: WorkEnvelope = Object.freeze({
        envelopeId: "envelope:" + randomUUID(),
        version,
        accountDomainId: this.#store.accountDomainId,
        projectId,
        ...(input.threadId
          ? { threadId: required(input.threadId, "Thread") }
          : {}),
        objectiveRef,
        scopeFingerprint,
        workClasses,
        allowedEffects,
        repositoryBoundary: input.repositoryBoundary,
        allowedCapabilities,
        continuationPolicy: input.continuationPolicy,
        ownerGateConditions,
        ...(input.budgetUsd !== undefined
          ? { budgetUsd: input.budgetUsd }
          : {}),
        ...(authorization
          ? { authorizationId: authorization.authorizationId }
          : {}),
        createdByPrincipalId: input.createdByPrincipalId,
        createdAt,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        state: "active"
      });

      const previousEnvelopes =
        snapshot.continuationControl.workEnvelopes.map((candidate) =>
          candidate.projectId === projectId &&
          candidate.objectiveRef === objectiveRef &&
          candidate.threadId === input.threadId &&
          candidate.state === "active"
            ? Object.freeze({ ...candidate, state: "superseded" as const })
            : candidate
        );

      const continuationControl = Object.freeze({
        ...snapshot.continuationControl,
        workEnvelopes: Object.freeze([
          ...previousEnvelopes,
          envelope
        ])
      });

      return {
        result: envelope,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl: snapshot.workerControl,
        continuationControl,
        changed: true
      };
    });
  }

  async grantAutonomy(
    input: GrantAutonomyInput
  ): Promise<AutonomyGrant> {
    await this.#assertHumanAdmin(input.grantedByPrincipalId);

    const projectId = required(input.projectId, "Project");
    const workClass = required(input.workClass, "Work class");
    const evidenceBasisRefs = uniqueStrings(
      input.evidenceBasisRefs,
      "Evidence basis"
    );
    const invalidationConditions = uniqueStrings(
      input.invalidationConditions ?? [],
      "Invalidation conditions",
      true
    );
    const grantedAt = input.grantedAt ?? new Date().toISOString();
    const grantedAtMs = time(grantedAt, "Grant grantedAt");

    if (
      !Number.isInteger(input.level) ||
      input.level < 0 ||
      input.level > 5
    ) {
      throw new ContinuationAuthorityError(
        "Autonomy level must be an integer from 0 through 5."
      );
    }
    if (
      input.reviewAfter &&
      time(input.reviewAfter, "Grant reviewAfter") <= grantedAtMs
    ) {
      throw new ContinuationAuthorityError(
        "Grant reviewAfter must be after grantedAt."
      );
    }
    if (input.lastProvenAt) {
      time(input.lastProvenAt, "Grant lastProvenAt");
    }

    return mutateControlRegistry(this.#store, (snapshot) => {
      if (!snapshot.projects.some((project) => project.projectId === projectId)) {
        throw new ContinuationAuthorityError(
          "Unknown Project: " + projectId
        );
      }

      const grant: AutonomyGrant = Object.freeze({
        grantId: "autonomy:" + randomUUID(),
        accountDomainId: this.#store.accountDomainId,
        projectId,
        workClass,
        level: input.level,
        repositoryCeiling: input.repositoryCeiling,
        grantedByPrincipalId: input.grantedByPrincipalId,
        grantedAt,
        evidenceBasisRefs,
        ...(input.lastProvenAt
          ? { lastProvenAt: input.lastProvenAt }
          : {}),
        ...(input.reviewAfter
          ? { reviewAfter: input.reviewAfter }
          : {}),
        invalidationConditions,
        state: "active"
      });

      const continuationControl = Object.freeze({
        ...snapshot.continuationControl,
        autonomyGrants: Object.freeze([
          ...snapshot.continuationControl.autonomyGrants,
          grant
        ])
      });

      return {
        result: grant,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl: snapshot.workerControl,
        continuationControl,
        changed: true
      };
    });
  }

  async getLatestWorkEnvelope(
    projectIdInput: string,
    workClassInput: string,
    threadId?: string
  ): Promise<WorkEnvelope | undefined> {
    const projectId = required(projectIdInput, "Project");
    const workClass = required(workClassInput, "Work class");
    const snapshot = await this.#store.load();
    return latestEnvelope(
      snapshot.continuationControl.workEnvelopes,
      {
        projectId,
        ...(threadId ? { threadId } : {}),
        workClass,
        requestedEffect: "read",
        requestedRepositoryBoundary: "read_only"
      }
    );
  }

  async getLatestAutonomyGrant(
    projectIdInput: string,
    workClassInput: string
  ): Promise<AutonomyGrant | undefined> {
    const projectId = required(projectIdInput, "Project");
    const workClass = required(workClassInput, "Work class");
    const snapshot = await this.#store.load();
    return latestGrant(
      snapshot.continuationControl.autonomyGrants,
      projectId,
      workClass
    );
  }

  async setGrantState(
    input: SetAutonomyGrantStateInput
  ): Promise<AutonomyGrant> {
    await this.#assertHumanAdmin(input.changedByPrincipalId);

    return mutateControlRegistry(this.#store, (snapshot) => {
      const index = snapshot.continuationControl.autonomyGrants.findIndex(
        (grant) => grant.grantId === input.grantId
      );
      if (index < 0) {
        throw new ContinuationAuthorityError("Unknown AutonomyGrant.");
      }

      const current = snapshot.continuationControl.autonomyGrants[index]!;
      if (current.state === input.state) {
        return {
          result: current,
          projects: snapshot.projects,
          connections: snapshot.connections,
          projectConnectionBindings: snapshot.projectConnectionBindings,
          delegations: snapshot.delegations,
          workerControl: snapshot.workerControl,
          continuationControl: snapshot.continuationControl,
          changed: false
        };
      }

      const updated = Object.freeze({
        ...current,
        state: input.state
      });
      const grants = [...snapshot.continuationControl.autonomyGrants];
      grants[index] = updated;

      return {
        result: updated,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl: snapshot.workerControl,
        continuationControl: Object.freeze({
          ...snapshot.continuationControl,
          autonomyGrants: Object.freeze(grants)
        }),
        changed: true
      };
    });
  }

  async evaluate(
    input: EvaluateContinuationInput
  ): Promise<ContinuationEvaluation> {
    const snapshot = await this.#store.load();
    const workClass = required(input.workClass, "Work class");

    if (!snapshot.projects.some(
      (project) => project.projectId === input.projectId
    )) {
      return this.#result(
        input,
        workClass,
        "blocked",
        "Project is not registered in this AccountDomain.",
        {}
      );
    }

    const control = currentControlMode(snapshot, input.projectId);
    if (control && control.mode !== "running") {
      return this.#result(
        input,
        workClass,
        "blocked",
        "Project ControlState is " + control.mode +
          " at generation " + control.generation + ".",
        {}
      );
    }

    if (input.explicitOwnerGateReached) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The current work reached an explicit owner gate.",
        {}
      );
    }

    const envelope = latestEnvelope(
      snapshot.continuationControl.workEnvelopes,
      input
    );
    if (!envelope) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "No WorkEnvelope covers this continuation.",
        {}
      );
    }

    const now = time(
      input.now ?? new Date().toISOString(),
      "Evaluation time"
    );
    const envelopeBasis = { envelopeId: envelope.envelopeId };

    if (envelope.state !== "active") {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The latest matching WorkEnvelope is " + envelope.state + ".",
        envelopeBasis
      );
    }
    if (envelope.expiresAt && time(
      envelope.expiresAt,
      "Envelope expiresAt"
    ) <= now) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The WorkEnvelope has expired.",
        envelopeBasis
      );
    }
    if (envelope.continuationPolicy === "interactive") {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The WorkEnvelope is interactive-only.",
        envelopeBasis
      );
    }
    if (!envelope.allowedEffects.includes(input.requestedEffect)) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The requested effect is outside the WorkEnvelope.",
        envelopeBasis
      );
    }
    if (
      BOUNDARY_RANK[input.requestedRepositoryBoundary] >
      BOUNDARY_RANK[envelope.repositoryBoundary]
    ) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The requested repository boundary exceeds the WorkEnvelope ceiling.",
        envelopeBasis
      );
    }
    if (
      input.capabilityId &&
      !envelope.allowedCapabilities.includes(input.capabilityId)
    ) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The requested capability is outside the WorkEnvelope.",
        envelopeBasis
      );
    }

    const grant = latestGrant(
      snapshot.continuationControl.autonomyGrants,
      input.projectId,
      workClass
    );
    if (!grant) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "No AutonomyGrant exists for this work class.",
        envelopeBasis
      );
    }

    const basis = {
      envelopeId: envelope.envelopeId,
      grantId: grant.grantId,
      autonomyLevel: grant.level,
      effectiveRepositoryCeiling: effectiveCeiling(envelope, grant),
      ...(envelope.authorizationId
        ? { authorizationId: envelope.authorizationId }
        : {})
    };

    if (grant.state !== "active") {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The latest AutonomyGrant is " + grant.state + ".",
        basis
      );
    }
    if (
      grant.reviewAfter &&
      time(grant.reviewAfter, "Grant reviewAfter") <= now
    ) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The AutonomyGrant is due for owner review.",
        basis
      );
    }
    if (grant.level < 2) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "Autonomy level does not permit automatic continuation.",
        basis
      );
    }
    if (
      BOUNDARY_RANK[input.requestedRepositoryBoundary] >
      BOUNDARY_RANK[grant.repositoryCeiling]
    ) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "The requested repository boundary exceeds the AutonomyGrant ceiling.",
        basis
      );
    }

    const mutable =
      input.requestedEffect === "mutate" ||
      BOUNDARY_RANK[input.requestedRepositoryBoundary] > 0;
    if (mutable && grant.level < 3) {
      return this.#result(
        input,
        workClass,
        "needs_owner",
        "Mutation/integration requires Autonomy level Integrate or higher.",
        basis
      );
    }

    if (mutable) {
      const authorization = envelope.authorizationId
        ? snapshot.workerControl.authorizations.find(
            (candidate) =>
              candidate.authorizationId === envelope.authorizationId
          )
        : undefined;

      if (
        !matchingAuthorization(authorization, {
          projectId: input.projectId,
          objectiveRef: envelope.objectiveRef,
          scopeFingerprint: envelope.scopeFingerprint
        })
      ) {
        return this.#result(
          input,
          workClass,
          "blocked",
          "Mutable continuation lacks an active matching WorkAuthorization.",
          basis
        );
      }
    }

    return this.#result(
      input,
      workClass,
      "allow",
      "Continuation is inside the active WorkEnvelope, AutonomyGrant, WorkAuthorization, and ControlState.",
      basis
    );
  }

  #result(
    input: EvaluateContinuationInput,
    workClass: string,
    decision: ContinuationEvaluation["decision"],
    reason: string,
    basis: ContinuationEvaluation["basis"]
  ): ContinuationEvaluation {
    return Object.freeze({
      decision,
      reason,
      accountDomainId: this.#store.accountDomainId,
      projectId: input.projectId,
      workClass,
      requestedEffect: input.requestedEffect,
      requestedRepositoryBoundary: input.requestedRepositoryBoundary,
      basis: Object.freeze({ ...basis })
    });
  }
}
