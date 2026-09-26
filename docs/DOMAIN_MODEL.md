# Domain Model — ASC v2 Target

This document describes the target control-plane model after the 2026-09-26 re-crystallization.

The current codebase still contains Slice A domain types from the 2026-09-18 architecture. Those types are retained until a bounded migration proves what can be reused.

## Primary entities

### Owner
The human authority controlling ASC.

ASC may begin single-owner, but owner identity must still be explicit because authorization and account separation depend on it.

### AccountDomain
A bounded personal/business context belonging to an Owner.

Examples:
- personal;
- one business;
- another business entity.

An AccountDomain scopes Projects, provider connections, and default authorization context. Provider identities must not bleed across domains implicitly.

Minimum fields:
- `account_domain_id`
- `owner_id`
- `name`
- `status`

### ProjectReference
ASC's durable reference to a Project.

The Project itself owns its product meaning in its own repository/systems. ASC stores only enough identity and references to locate authoritative sources.

Minimum fields:
- `project_id`
- `account_domain_id`
- `name`
- `references[]` (GitHub repository, DI project, Conductor execution referent, provider project ids, etc.)
- `status`

A Project is not a checkout, chat, worker, or copied project-truth database.

### Connection
An owner-authorized identity/installation/account for an external provider.

Examples:
- GitHub App installation;
- Google identity;
- Vercel team/account;
- Supabase organization/project access.

ASC brokers references/scoped grants. It must not become a raw-secret distributor.

Minimum fields:
- `connection_id`
- `account_domain_id`
- `provider`
- opaque provider/identity reference
- granted scopes/capabilities
- status/freshness
- no raw secret material in owner/audit surfaces

### WorkAuthorization
An explicit owner-verification record granting bounded work authority.

Work lifecycle status is not authorization.

Minimum fields:
- `authorization_id`
- `project_id`
- work/objective reference
- `verification_kind`: intent | result
- reviewed scope/fingerprint
- optional project/DI revision references used at verification time
- `verified_by`
- `verified_at`
- `state`: active | revoked | superseded | needs_revalidation

Material scope or controlling-context changes may move an authorization to `needs_revalidation`.

### WorkerSession
An ephemeral reasoning/execution session assigned to authorized work.

Minimum fields:
- `worker_id`
- `project_id`
- `authorization_id`
- runtime/model/session reference
- optional parent worker
- `state`: starting | active | stopping | stopped | blocked | completed | expired
- started/ended timestamps
- heartbeat/last-observed time when available

Workers are replaceable and do not own project truth.

### ExecutionLease
Short-lived permission for a WorkerSession to use bounded capabilities.

Minimum fields:
- `lease_id`
- `worker_id`
- `authorization_id`
- allowed capability references/scopes
- `issued_at`
- `expires_at`
- `control_generation`
- `state`: active | expired | revoked

A lease is invalid if its control generation no longer matches the applicable control state.

### ControlState
Deterministic stop/pause authority.

Scopes:
- system;
- account domain;
- project;
- worker.

Minimum fields:
- scope identity;
- `mode`: running | paused | owner_stopped
- monotonically increasing `generation`;
- changed_by;
- changed_at;
- reason/reference when applicable.

Lower-authority agents cannot clear an owner stop.

### CapabilityGrant
A scoped permission to request an externally realized capability.

Capabilities are discovered from owning systems such as Conductor or DI. ASC records which capability references may be used under which connection/project/lease; it does not reimplement the capability.

### OrchestrationEvent
Minimal append-only event/reference used to reconstruct control flow.

Examples:
- authorization granted/revoked;
- worker assigned/started/stopped/completed;
- lease issued/revoked/expired;
- control state changed;
- execution/result reference attached;
- owner attention requested.

Events should reference provider/DI/GitHub/Conductor evidence rather than copying complete native state.

## Project meaning

Product direction, principles, architecture, legal/product constraints, and project-local decisions belong to the Project's own repository and history.

DI owns evidence-backed interpretation/evaluation of those sources.

ASC may bind authorization to relevant project/DI revisions, but does not store a competing canonical intent model.

## Legacy concepts

The original ASC architecture centered on Workspace, CapabilityBinding, DesiredState/Drift, Action, PolicyDecision, EffectReceipt, and Reconciliation.

Useful invariants from those concepts remain:
- observed truth requires provenance;
- unknown/stale/indeterminate are valid;
- tool availability is not authorization;
- provider success is not verified reality;
- permission failures must not silently broaden credentials.

Execution receipts and provider mechanics now primarily belong to Conductor; project meaning/evaluation belongs to Project + DI. Legacy types should be migrated only when a concrete v2 slice proves the replacement.
