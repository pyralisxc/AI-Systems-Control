# Domain Model — ASC v2 Target

This document describes the target control-plane model after the 2026-09-26 re-crystallization and the 2026-09-27 multi-user foundation correction.

The current codebase still contains Slice A domain types from the 2026-09-18 architecture. Those types are retained until bounded migrations prove what can be reused.

## Primary entities

### Principal
A stable ASC actor identity independent from authentication provider.

Kinds:
- human;
- service.

A Principal may authenticate through local bootstrap, OIDC/federation, or a future enterprise identity adapter. Email is not canonical identity.

Minimum fields:
- `principal_id`
- `kind`
- `display_name`
- `status`
- created/updated timestamps

### AccountDomain
ASC's primary tenant/security boundary for personal or organizational use.

Examples:
- one person's private ASC context;
- CardForge;
- another company or business unit when independent isolation is required.

An AccountDomain does not belong to a singular Owner object. Principals relate to it through Memberships.

Minimum fields:
- `account_domain_id`
- `kind`: personal | organization
- `name`
- `status`

Tenant-owned Projects, Connections, Threads, authorizations, workers/leases, control state, budgets, and orchestration events must carry/enforce AccountDomain context.

### Membership
The explicit relationship between a Principal and an AccountDomain.

Minimum fields:
- `membership_id`
- `principal_id`
- `account_domain_id`
- role/policy references
- `status`
- created/updated/revoked timestamps

"Owner" is a role/authority held by a Membership, not ASC's root identity type.

Personal mode is one human Principal + one personal AccountDomain + one active owner Membership.

### ProjectReference
ASC's durable reference to a Project.

The Project itself owns its product meaning in its own repository/systems. ASC stores only enough identity and references to locate authoritative sources.

Minimum fields:
- `project_id`
- `account_domain_id`
- `name`
- `references[]`
- `status`

A Project is not a checkout, chat, worker, or copied project-truth database.

### Connection
An AccountDomain-scoped external provider identity/installation/account authorized by a Principal.

Examples:
- GitHub App installation;
- Google identity;
- Vercel team/account;
- Supabase organization/project access.

ASC brokers references/scoped grants. It must not become a raw-secret distributor.

Minimum fields:
- `connection_id`
- `account_domain_id`
- `authorized_by_principal_id`
- `provider`
- opaque provider/identity reference
- granted capabilities
- status/generation/freshness
- no raw secret material in owner/audit surfaces

A Connection belongs to its AccountDomain. Replacing the administering human does not transfer Connection identity.

### WorkAuthorization
A durable bounded authorization produced from valid approval/policy.

Personal UI may continue to say "Owner Verified", but the underlying record must not assume one global human owner.

Minimum fields:
- `authorization_id`
- `account_domain_id`
- `project_id`
- work/objective reference
- `verification_kind`: intent | result
- reviewed scope/fingerprint
- optional project/DI revision references
- approving Principal/approval references
- `verified_at`
- `state`: active | revoked | superseded | needs_revalidation

Material scope or controlling-context changes may move an authorization to `needs_revalidation`.

### WorkEnvelope
A versioned bounded continuation contract for one Project objective, optionally narrowed to one ConversationThread.

A WorkEnvelope defines what continuation may attempt; it never creates authority beyond the underlying WorkAuthorization.

Minimum fields:
- `envelope_id` + version/state;
- AccountDomain + Project + optional Thread;
- objective/work reference + scope fingerprint;
- allowed work classes;
- allowed effect classes/capabilities;
- repository ceiling: read_only | work_branch | preview | main;
- continuation policy: interactive | continue_until_gate | autonomous_bounded;
- owner-gate conditions;
- optional budget/expiry;
- WorkAuthorization reference when mutable/integration authority is included;
- creating Principal/time.

A newer envelope version supersedes the earlier active version for the same bounded objective.

### AutonomyGrant
A dated, scoped delegation over one Project work class.

Autonomy is not a global trust score.

Levels:
- 0 Observe;
- 1 Suggest;
- 2 Continue;
- 3 Integrate;
- 4 Operate;
- 5 Extended.

Minimum fields:
- grant ID;
- AccountDomain + Project;
- work class;
- level;
- repository ceiling;
- granting Principal/time;
- evidence-basis references;
- last-proven/review-after timestamps when applicable;
- invalidation conditions;
- state: active | needs_review | revoked.

Effective continuation authority is the intersection of the active WorkEnvelope, AutonomyGrant, WorkAuthorization where mutation is involved, and current ControlState. A high level never widens an envelope or overrides STOP.

### ConversationThread
A durable owner-facing conversation identity independent from any one model/runtime session.

Minimum fields:
- `thread_id`
- AccountDomain + optional Project
- mode: external | bridged | managed
- lifecycle
- runtime capability flags
- optional external provider/thread/navigation reference
- created/updated timestamps

Thread checkpoints, activity, Relay records, and synopsis history are interaction/orchestration state. They are not canonical Project meaning.

### FounderRelayRecord
A provenance-preserving proposed or delivered owner-channel continuation attached to one ConversationThread.

Minimum fields:
- Relay ID, Thread, AccountDomain, Project;
- represented human Principal;
- generating service Principal;
- proposal mode: suggest | auto_candidate;
- immutable proposed text;
- optional final text;
- work class + requested effect/repository boundary/capability;
- source/evidence refs;
- proposal-time continuation-authority evaluation;
- optional delivery-time continuation-authority evaluation;
- state: suggested | owner_approved | edited | rejected | auto_sent;
- owner feedback Principal/time;
- delivery time/reference when actually delivered.

`owner_approved` and `edited` are owner-assisted interaction records. They are not retroactively rewritten as literal owner-authored text.

`auto_sent` is reserved for a Relay that:
1. re-evaluated current continuation authority at delivery time and received `allow`; and
2. was actually accepted by a send-capable idempotent transport.

An external/bridged Thread with no send-capable transport can never be labeled auto-sent.

### WorkerSession / WorkerRun
An ephemeral reasoning/execution episode assigned to authorized work.

Minimum fields:
- worker/run identity
- AccountDomain + Project
- authorization reference
- service Principal / runtime/model/session reference
- optional parent worker
- lifecycle state
- started/ended/heartbeat timestamps

Workers are replaceable and do not own Project truth.

### ExecutionLease
Short-lived permission for a WorkerSession/Run to use bounded capabilities.

Minimum fields:
- `lease_id`
- worker/run identity
- authorization reference
- allowed capability references/scopes
- issued/expires timestamps
- `control_generation`
- `state`

A lease is invalid if its control generation no longer matches applicable ControlState.

### ControlState
Deterministic stop/pause authority.

Scopes:
- system;
- AccountDomain;
- Project;
- Worker.

Minimum fields:
- scope identity
- `mode`: running | paused | owner_stopped
- monotonically increasing `generation`
- changed-by Principal/service identity
- changed-at
- reason/reference

Lower-authority agents cannot clear an owner-level stop.

### CapabilityGrant
A scoped permission to request an externally realized capability.

Capabilities are discovered from owning systems such as Conductor or DI. ASC records which capability references may be used under which connection/project/lease; it does not reimplement the capability.

### OrchestrationEvent
Minimal append-only event/reference used to reconstruct control flow.

Events should identify AccountDomain and actor Principal/service identity and reference provider/DI/GitHub/Conductor evidence rather than copying complete native state.

## Identity / authentication boundary

Authentication identity is not ASC resource authority.

Authentication providers map authenticated identities to Principals. Membership establishes tenant context. Authorization policy then evaluates what that Principal may do in that AccountDomain.

Future OIDC/SAML/SCIM adapters must not change Principal, Membership, Project, Connection, Thread, or WorkAuthorization identity semantics.

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

Execution receipts/provider mechanics now primarily belong to Conductor; Project meaning/evaluation belongs to Project + DI.
