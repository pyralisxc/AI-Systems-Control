import { randomUUID } from "node:crypto";

import type {
  EffectClass,
  ExecutionLease,
  OrchestrationEvent,
  ProjectControlState,
  WorkAuthorization,
  WorkerControlState,
  WorkerRun,
  WorkVerificationKind
} from "../domain/index.js";
import type { ControlRegistryStore } from "../ports/index.js";
import { mutateControlRegistry } from "./control-registry-mutation.js";
import { PersistentIdentityRegistry } from "./persistent-identity-registry.js";

export interface ApproveWorkInput {
  readonly projectId: string;
  readonly approvedByPrincipalId: string;
  readonly workReference: string;
  readonly scopeFingerprint: string;
  readonly verificationKind?: WorkVerificationKind;
  readonly approvedAt?: string;
}

export interface StartWorkerInput {
  readonly authorizationId: string;
  readonly actingPrincipalId: string;
  readonly runtimeRef?: string;
  readonly startedAt?: string;
}

export interface IssueExecutionLeaseInput {
  readonly workerRunId: string;
  readonly allowedCapabilities: readonly string[];
  readonly allowedEffects: readonly EffectClass[];
  readonly expiresInSeconds?: number;
  readonly issuedAt?: string;
}

export interface ValidateExecutionLeaseInput {
  readonly leaseId: string;
  readonly capabilityId: string;
  readonly effectClass: EffectClass;
  readonly now?: string;
}

export interface LeaseValidationReceipt {
  readonly leaseId: string;
  readonly authorizationId: string;
  readonly workerRunId: string;
  readonly accountDomainId: string;
  readonly projectId: string;
  readonly approvedByPrincipalId: string;
  readonly actedByPrincipalId: string;
  readonly controlGeneration: number;
  readonly validatedAt: string;
}

export interface StopProjectInput {
  readonly projectId: string;
  readonly changedByPrincipalId: string;
  readonly reason?: string;
  readonly changedAt?: string;
}

export class WorkerAuthorityError extends Error {
  readonly code = "worker_authority_failed";

  constructor(message: string) {
    super(message);
    this.name = "WorkerAuthorityError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new WorkerAuthorityError(label + " is required.");
  return normalized;
}

function freezeControl(state: WorkerControlState): WorkerControlState {
  return Object.freeze({
    approvals: Object.freeze([...state.approvals]),
    authorizations: Object.freeze([...state.authorizations]),
    workerRuns: Object.freeze([...state.workerRuns]),
    leases: Object.freeze([...state.leases]),
    projectControls: Object.freeze([...state.projectControls]),
    events: Object.freeze([...state.events])
  });
}

function makeEvent(
  input: Omit<OrchestrationEvent, "eventId">
): OrchestrationEvent {
  return Object.freeze({
    eventId: "event:" + randomUUID(),
    ...input
  });
}

function projectControl(
  state: WorkerControlState,
  accountDomainId: string,
  projectId: string
): ProjectControlState {
  return state.projectControls.find(
    (candidate) => candidate.projectId === projectId
  ) ?? Object.freeze({
    accountDomainId,
    projectId,
    mode: "running",
    generation: 0
  });
}

export class WorkerAuthorityService {
  readonly #store: ControlRegistryStore;
  readonly #identities: PersistentIdentityRegistry;

  constructor(
    store: ControlRegistryStore,
    identities: PersistentIdentityRegistry
  ) {
    this.#store = store;
    this.#identities = identities;
  }

  async #humanApprover(principalId: string) {
    const principal = await this.#identities.getPrincipal(principalId);
    if (!principal || principal.status !== "active") {
      throw new WorkerAuthorityError("Approving Principal is inactive.");
    }
    if (principal.kind !== "human") {
      throw new WorkerAuthorityError(
        "Protected work approval requires a human Principal."
      );
    }

    const membership = await this.#identities.getMembership(
      principalId,
      this.#store.accountDomainId
    );
    if (!membership || membership.status !== "active") {
      throw new WorkerAuthorityError(
        "Approving Principal lacks active Membership in this AccountDomain."
      );
    }
    if (
      !membership.roles.includes("owner") &&
      !membership.roles.includes("admin")
    ) {
      throw new WorkerAuthorityError(
        "Approving Principal lacks owner/admin authority."
      );
    }
    return membership;
  }

  async #serviceActor(principalId: string) {
    const principal = await this.#identities.getPrincipal(principalId);
    if (!principal || principal.status !== "active") {
      throw new WorkerAuthorityError("Worker Principal is inactive.");
    }
    if (principal.kind !== "service") {
      throw new WorkerAuthorityError(
        "WorkerRun requires a service Principal."
      );
    }

    const membership = await this.#identities.getMembership(
      principalId,
      this.#store.accountDomainId
    );
    if (!membership || membership.status !== "active") {
      throw new WorkerAuthorityError(
        "Worker Principal lacks active Membership in this AccountDomain."
      );
    }
    if (
      !membership.roles.some((role) =>
        role === "operator" || role === "admin" || role === "owner"
      )
    ) {
      throw new WorkerAuthorityError(
        "Worker Principal lacks operator authority."
      );
    }
    return membership;
  }

  async approveWork(input: ApproveWorkInput): Promise<WorkAuthorization> {
    const projectId = required(input.projectId, "Project");
    const workReference = required(input.workReference, "Work reference");
    const scopeFingerprint = required(
      input.scopeFingerprint,
      "Scope fingerprint"
    );
    const membership = await this.#humanApprover(
      input.approvedByPrincipalId
    );
    const approvedAt = input.approvedAt ?? new Date().toISOString();

    return mutateControlRegistry(this.#store, (snapshot) => {
      if (!snapshot.projects.some((project) => project.projectId === projectId)) {
        throw new WorkerAuthorityError("Unknown Project: " + projectId);
      }

      const approvalId = "approval:" + randomUUID();
      const authorizationId = "authorization:" + randomUUID();
      const verificationKind = input.verificationKind ?? "intent";

      const approval = Object.freeze({
        approvalId,
        accountDomainId: this.#store.accountDomainId,
        projectId,
        approvedByPrincipalId: input.approvedByPrincipalId,
        membershipId: membership.membershipId,
        workReference,
        scopeFingerprint,
        verificationKind,
        approvedAt
      });
      const authorization: WorkAuthorization = Object.freeze({
        authorizationId,
        accountDomainId: this.#store.accountDomainId,
        projectId,
        approvalId,
        workReference,
        scopeFingerprint,
        verificationKind,
        approvedByPrincipalId: input.approvedByPrincipalId,
        state: "active",
        authorizedAt: approvedAt
      });

      const workerControl = freezeControl({
        ...snapshot.workerControl,
        approvals: [...snapshot.workerControl.approvals, approval],
        authorizations: [
          ...snapshot.workerControl.authorizations,
          authorization
        ],
        events: [
          ...snapshot.workerControl.events,
          makeEvent({
            accountDomainId: this.#store.accountDomainId,
            projectId,
            type: "approval.recorded",
            occurredAt: approvedAt,
            approvedByPrincipalId: input.approvedByPrincipalId,
            reference: approvalId
          }),
          makeEvent({
            accountDomainId: this.#store.accountDomainId,
            projectId,
            type: "authorization.created",
            occurredAt: approvedAt,
            authorizationId,
            approvedByPrincipalId: input.approvedByPrincipalId,
            reference: workReference
          })
        ]
      });

      return {
        result: authorization,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl,
        changed: true
      };
    });
  }

  async startWorker(input: StartWorkerInput): Promise<WorkerRun> {
    const actingPrincipalId = required(
      input.actingPrincipalId,
      "Acting Principal"
    );
    await this.#serviceActor(actingPrincipalId);
    const startedAt = input.startedAt ?? new Date().toISOString();

    return mutateControlRegistry(this.#store, (snapshot) => {
      const authorization = snapshot.workerControl.authorizations.find(
        (candidate) =>
          candidate.authorizationId === input.authorizationId
      );
      if (!authorization || authorization.state !== "active") {
        throw new WorkerAuthorityError(
          "WorkAuthorization is missing or inactive."
        );
      }

      const workerRun: WorkerRun = Object.freeze({
        workerRunId: "worker:" + randomUUID(),
        accountDomainId: this.#store.accountDomainId,
        projectId: authorization.projectId,
        authorizationId: authorization.authorizationId,
        actingPrincipalId,
        ...(input.runtimeRef ? { runtimeRef: input.runtimeRef } : {}),
        state: "active",
        startedAt
      });

      const workerControl = freezeControl({
        ...snapshot.workerControl,
        workerRuns: [...snapshot.workerControl.workerRuns, workerRun],
        events: [
          ...snapshot.workerControl.events,
          makeEvent({
            accountDomainId: this.#store.accountDomainId,
            projectId: authorization.projectId,
            type: "worker.started",
            occurredAt: startedAt,
            authorizationId: authorization.authorizationId,
            workerRunId: workerRun.workerRunId,
            approvedByPrincipalId: authorization.approvedByPrincipalId,
            actedByPrincipalId: actingPrincipalId
          })
        ]
      });

      return {
        result: workerRun,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl,
        changed: true
      };
    });
  }

  async issueLease(
    input: IssueExecutionLeaseInput
  ): Promise<ExecutionLease> {
    const issuedAt = input.issuedAt ?? new Date().toISOString();
    const ttl = input.expiresInSeconds ?? 300;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 3600) {
      throw new WorkerAuthorityError(
        "ExecutionLease TTL must be between 1 and 3600 seconds."
      );
    }
    if (input.allowedCapabilities.length === 0) {
      throw new WorkerAuthorityError(
        "ExecutionLease requires at least one capability."
      );
    }
    if (input.allowedEffects.length === 0) {
      throw new WorkerAuthorityError(
        "ExecutionLease requires at least one effect class."
      );
    }

    const before = await this.#store.load();
    const existingWorker = before.workerControl.workerRuns.find(
      (candidate) => candidate.workerRunId === input.workerRunId
    );
    if (!existingWorker || existingWorker.state !== "active") {
      throw new WorkerAuthorityError("WorkerRun is missing or inactive.");
    }
    await this.#serviceActor(existingWorker.actingPrincipalId);

    return mutateControlRegistry(this.#store, (snapshot) => {
      const worker = snapshot.workerControl.workerRuns.find(
        (candidate) => candidate.workerRunId === input.workerRunId
      );
      if (!worker || worker.state !== "active") {
        throw new WorkerAuthorityError("WorkerRun is missing or inactive.");
      }

      const authorization = snapshot.workerControl.authorizations.find(
        (candidate) =>
          candidate.authorizationId === worker.authorizationId
      );
      if (!authorization || authorization.state !== "active") {
        throw new WorkerAuthorityError(
          "WorkAuthorization is missing or inactive."
        );
      }

      const control = projectControl(
        snapshot.workerControl,
        this.#store.accountDomainId,
        worker.projectId
      );
      if (control.mode !== "running") {
        throw new WorkerAuthorityError(
          "Project control state does not permit execution."
        );
      }

      const lease: ExecutionLease = Object.freeze({
        leaseId: "lease:" + randomUUID(),
        accountDomainId: this.#store.accountDomainId,
        projectId: worker.projectId,
        authorizationId: authorization.authorizationId,
        workerRunId: worker.workerRunId,
        actingPrincipalId: worker.actingPrincipalId,
        allowedCapabilities: Object.freeze([
          ...new Set(
            input.allowedCapabilities.map((value) =>
              required(value, "Capability")
            )
          )
        ]),
        allowedEffects: Object.freeze([...new Set(input.allowedEffects)]),
        issuedAt,
        expiresAt: new Date(
          Date.parse(issuedAt) + ttl * 1000
        ).toISOString(),
        controlGeneration: control.generation,
        state: "active"
      });

      const workerControl = freezeControl({
        ...snapshot.workerControl,
        leases: [...snapshot.workerControl.leases, lease],
        events: [
          ...snapshot.workerControl.events,
          makeEvent({
            accountDomainId: this.#store.accountDomainId,
            projectId: worker.projectId,
            type: "lease.issued",
            occurredAt: issuedAt,
            authorizationId: authorization.authorizationId,
            workerRunId: worker.workerRunId,
            leaseId: lease.leaseId,
            approvedByPrincipalId: authorization.approvedByPrincipalId,
            actedByPrincipalId: worker.actingPrincipalId
          })
        ]
      });

      return {
        result: lease,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl,
        changed: true
      };
    });
  }

  async validateLease(
    input: ValidateExecutionLeaseInput
  ): Promise<LeaseValidationReceipt> {
    const snapshot = await this.#store.load();
    const lease = snapshot.workerControl.leases.find(
      (candidate) => candidate.leaseId === input.leaseId
    );
    if (!lease || lease.state !== "active") {
      throw new WorkerAuthorityError(
        "ExecutionLease is missing or inactive."
      );
    }

    const now = input.now ?? new Date().toISOString();
    if (Date.parse(lease.expiresAt) <= Date.parse(now)) {
      throw new WorkerAuthorityError("ExecutionLease has expired.");
    }
    if (!lease.allowedCapabilities.includes(input.capabilityId)) {
      throw new WorkerAuthorityError(
        "ExecutionLease does not allow the requested capability."
      );
    }
    if (!lease.allowedEffects.includes(input.effectClass)) {
      throw new WorkerAuthorityError(
        "ExecutionLease does not allow the requested effect."
      );
    }

    const worker = snapshot.workerControl.workerRuns.find(
      (candidate) => candidate.workerRunId === lease.workerRunId
    );
    if (!worker || worker.state !== "active") {
      throw new WorkerAuthorityError("WorkerRun is missing or inactive.");
    }
    await this.#serviceActor(worker.actingPrincipalId);

    const authorization = snapshot.workerControl.authorizations.find(
      (candidate) => candidate.authorizationId === lease.authorizationId
    );
    if (!authorization || authorization.state !== "active") {
      throw new WorkerAuthorityError(
        "WorkAuthorization is missing or inactive."
      );
    }

    const control = projectControl(
      snapshot.workerControl,
      this.#store.accountDomainId,
      lease.projectId
    );
    if (
      control.mode !== "running" ||
      control.generation !== lease.controlGeneration
    ) {
      throw new WorkerAuthorityError(
        "ExecutionLease control generation is stale or stopped."
      );
    }

    return Object.freeze({
      leaseId: lease.leaseId,
      authorizationId: authorization.authorizationId,
      workerRunId: worker.workerRunId,
      accountDomainId: this.#store.accountDomainId,
      projectId: lease.projectId,
      approvedByPrincipalId: authorization.approvedByPrincipalId,
      actedByPrincipalId: worker.actingPrincipalId,
      controlGeneration: lease.controlGeneration,
      validatedAt: now
    });
  }

  async stopProject(input: StopProjectInput): Promise<ProjectControlState> {
    await this.#humanApprover(input.changedByPrincipalId);
    const changedAt = input.changedAt ?? new Date().toISOString();

    return mutateControlRegistry(this.#store, (snapshot) => {
      if (!snapshot.projects.some(
        (project) => project.projectId === input.projectId
      )) {
        throw new WorkerAuthorityError(
          "Unknown Project: " + input.projectId
        );
      }

      const previous = projectControl(
        snapshot.workerControl,
        this.#store.accountDomainId,
        input.projectId
      );
      const control: ProjectControlState = Object.freeze({
        accountDomainId: this.#store.accountDomainId,
        projectId: input.projectId,
        mode: "owner_stopped",
        generation: previous.generation + 1,
        changedByPrincipalId: input.changedByPrincipalId,
        changedAt,
        ...(input.reason ? { reason: input.reason } : {})
      });

      const otherControls = snapshot.workerControl.projectControls.filter(
        (candidate) => candidate.projectId !== input.projectId
      );
      const workerControl = freezeControl({
        ...snapshot.workerControl,
        projectControls: [...otherControls, control],
        events: [
          ...snapshot.workerControl.events,
          makeEvent({
            accountDomainId: this.#store.accountDomainId,
            projectId: input.projectId,
            type: "control.changed",
            occurredAt: changedAt,
            actedByPrincipalId: input.changedByPrincipalId,
            reference: "owner_stopped:" + control.generation
          })
        ]
      });

      return {
        result: control,
        projects: snapshot.projects,
        connections: snapshot.connections,
        projectConnectionBindings: snapshot.projectConnectionBindings,
        delegations: snapshot.delegations,
        workerControl,
        changed: true
      };
    });
  }

  async getProjectAudit(
    projectId: string
  ): Promise<readonly OrchestrationEvent[]> {
    const snapshot = await this.#store.load();
    return Object.freeze(
      snapshot.workerControl.events.filter(
        (candidate) => candidate.projectId === projectId
      )
    );
  }
}
