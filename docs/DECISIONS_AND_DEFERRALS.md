# Decisions, Deferrals, and Rejected Directions

## Accepted
- AI Systems Control is a control plane centered on Project, Workspace, Capability, and Action.
- Capability realization is host-aware through explicit bindings.
- Desired state and observed state are distinct.
- Observed truth requires provenance and freshness.
- External mutation is governed through Actions.
- Provider/executor success produces an Effect Receipt, then reconciliation verifies reality.
- Permission failures become explicit escalation requirements.
- Slice A starts with GitHub Project Reality.
- Reusable web/product infrastructure is extracted source-first into a separate Web Foundation.
- Specialist systems retain engine/domain ownership rather than being folded into the control plane.
- AI Systems Control is the canonical integrated owner-facing website for specialist-system capabilities.
- Development Intelligence's direct Workbench is retained as a diagnostic/reference surface, not the primary integrated owner experience.
- Hosting follows ownership: AI Systems Control and Development Intelligence use separate Vercel projects in the same Vercel team.

## Deferred
- full autonomous policy authoring;
- multi-user organization/role administration beyond what the first slices require;
- generalized deployment/infrastructure providers;
- cross-project portfolio automation;
- advanced cost/budget policy;
- rich mobile experience;
- autonomous remediation of drift;
- marketplace/plugin distribution semantics.

Deferred means "not required to prove the control-plane spine," not rejected.

## Rejected for the initial architecture
- direct provider mutation from arbitrary UI buttons;
- one universal agent that owns reasoning, orchestration, reality, and execution;
- treating chats as durable Project state;
- treating tool availability as authorization;
- treating a provider success response as verified reality;
- copying CardForge wholesale into a generic website template repository before source ownership is understood;
- maintaining parallel feature implementations after a canonical reusable owner exists.

## Change rule
A change to an Accepted decision requires:
1. a new ADR or explicit amendment;
2. impact analysis against the battle tests;
3. migration consequences for existing slices;
4. owner-visible rationale.
