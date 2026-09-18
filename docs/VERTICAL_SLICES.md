# Vertical Slices

The system is built through end-to-end slices that prove control-plane invariants rather than horizontal framework construction.

## Slice A — GitHub Project Reality

**Status: first build referent**

### Goal
Open a real GitHub-backed Project in AI Systems Control and present trustworthy current project reality with provenance, desired-vs-observed comparison, and capability availability.

### Boundary
This slice is read-oriented. It must not require a mutation path to prove value.

### Flow
1. Register/resolve a Project from canonical GitHub repository identity.
2. Open a Workspace for the Project.
3. Resolve host-aware capability bindings for observation.
4. Request normalized project reality from the project-reality boundary, with Development Intelligence as the semantic authority.
5. Preserve source references and freshness.
6. Render observed state.
7. Load any applicable desired-state declarations.
8. Compute alignment/drift/unknown/stale outcomes.
9. Render capability availability, including permission-blocked states.
10. Produce no external mutation.

### Minimum observed model
- project/repository identity;
- default branch;
- referenced revision/HEAD when available;
- branch/revision freshness;
- open pull-request summary;
- issue/work state summary where available;
- CI/workflow status summary where available;
- Development Intelligence analysis status/evidence availability;
- explicit unknowns for unavailable data.

### Acceptance criteria
- A Project is stable across multiple Workspaces.
- The UI never reports provider data without source/freshness metadata.
- Development Intelligence output is consumed through an interface, not copied into this codebase.
- Missing DI/provider connectivity degrades to unknown/unavailable instead of fabricated state.
- Desired-vs-observed comparison can represent aligned, divergent, unknown, incomparable, and stale.
- Capability resolution reports why a known capability is unavailable.
- No GitHub write tool is callable from the Slice A application path.

## Slice B — Governed GitHub Action

Introduce the first low-risk mutation through the complete Action lifecycle, such as creating a clearly scoped development issue.

Must prove:
- Action proposal;
- binding resolution;
- policy check;
- explicit authorization if required;
- effect execution;
- Effect Receipt;
- fresh reconciliation;
- verified vs indeterminate outcomes.

## Slice C — Conductor Handoff

A verified/authorized objective is handed to Conductor for multi-step execution while AI Systems Control remains the control and audit surface.

Must prove:
- orchestration ownership remains in Conductor;
- action/run correlation;
- progress observation;
- pause/escalation propagation;
- final receipts and reconciliation.

## Slice D — Multi-host Capability Binding

Demonstrate one logical Capability realized differently across hosts/environments without leaking provider-specific behavior into the domain model.

## Slice E — Foundation-aware Project

Represent a project that consumes the reusable Web Foundation and surface its version/capability/upgrade state without moving foundation ownership into this repository.
