# AI Systems Control

AI Systems Control is the owner-facing control plane for connecting projects, workspaces, capabilities, and governed actions across the development system.

This repository crystallizes the architecture resolved in the Dev OS Outlook audit. It is intentionally a control plane, not a replacement for the specialist systems around it.

## Ownership boundary

- **AI Systems Control** owns Project, Workspace, Capability, Capability Binding, Desired/Observed State, governed Action, Policy Decision, and Effect Receipt.
- **Development Intelligence** owns evidence-backed project reality and semantic repository understanding.
- **Development OS** owns development reasoning, methods, and specialist decision procedures.
- **Conductor** owns multi-step work orchestration and execution sequencing.
- **Web Foundation** remains a separate reusable website/product foundation extracted source-first from proven implementations such as CardForge.
- Provider systems such as GitHub remain external sources/effectors. Their native state is not duplicated as a second truth.

## First build referent

The first vertical slice is **Slice A — GitHub Project Reality**.

It proves the control-plane model end-to-end without beginning with mutation:
1. identify a Project from a GitHub repository;
2. create/open an operator Workspace;
3. resolve the available host-aware capabilities;
4. obtain normalized observed reality through the project-reality boundary;
5. compare desired and observed state with evidence and freshness;
6. preserve explicit provenance and degraded/unknown states;
7. stop before any provider mutation unless it is represented as a governed Action.

See [PRODUCT_CRYSTAL.md](PRODUCT_CRYSTAL.md), [docs/VERTICAL_SLICES.md](docs/VERTICAL_SLICES.md), and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Core invariant

> No externally meaningful mutation occurs because a tool happens to be available. It occurs because an Action was proposed, evaluated by policy, explicitly authorized when required, executed through a capability binding, and reconciled into an Effect Receipt plus fresh observed state.

## Development status

**Crystallized / ready for Slice A implementation.** The documents in this repository are the initial implementation authority. Changes to frozen system boundaries require an ADR and corresponding battle-test changes.
