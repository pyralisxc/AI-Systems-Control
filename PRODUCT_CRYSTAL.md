# Product Crystal — AI Systems Control

Status: **Frozen for initial implementation**  
Crystallized: **2026-09-18**

## Product statement

AI Systems Control is the owner-facing system of control for an increasingly agentic development environment. Its job is to make the state, capabilities, intended changes, permissions, and realized effects of connected systems legible and governable from one place.

The product is not "one giant agent." It is the control surface and contract layer that allows specialist systems to remain specialist while still behaving as one coherent operating environment.

## User problem

As the development stack grows, capability increases faster than operator legibility. GitHub, Development Intelligence, Development OS, Conductor, web/product foundations, hosted services, and future systems each expose different state and different actions. Without a control plane:

- the same project can be represented differently in multiple systems;
- a capability can exist but not be discoverable in the current context;
- an agent can have a tool without the owner understanding whether it is authorized to use it;
- desired state and observed state drift silently;
- successful tool calls can be mistaken for successful real-world outcomes;
- provider permission failures become ad-hoc troubleshooting instead of a governed escalation;
- reusable architectural gains are lost when each new product starts from scratch.

AI Systems Control exists to solve those coordination and control failures.

## Frozen domain center

The control plane is organized around four primary nouns:

1. **Project** — durable identity for a real product/system and the references needed to observe or affect it.
2. **Workspace** — an operator-scoped working context over a Project. A Workspace can select hosts, environments, views, intentions, and capability bindings without becoming a second Project truth.
3. **Capability** — a typed operation a system knows how to perform.
4. **Action** — a governed proposal to change external state through a bound capability.

Supporting nouns include Capability Binding, Desired State, Observation, Evidence Reference, Policy Decision, Authorization, Effect Receipt, and Reconciliation.

## System boundaries

### AI Systems Control owns
- project registry and project references;
- workspace lifecycle and workspace-local selections;
- capability catalog and host-aware bindings;
- desired-state declarations that belong to the operator/control plane;
- normalized observed-state projections consumed from reality providers;
- desired-vs-observed comparison;
- Action lifecycle;
- policy evaluation and authorization state;
- effect execution handoff;
- Effect Receipts and reconciliation status;
- owner-facing status and escalation presentation.

### Development Intelligence owns
- repository/project evidence gathering;
- semantic interpretation of project reality;
- claims/proof about the codebase;
- source attribution and confidence/freshness semantics for its observations.

AI Systems Control consumes this reality. It does not reproduce Development Intelligence inside the control plane.

### Development OS owns
- reasoning frameworks;
- development procedures;
- specialist decision methods;
- evidence stewardship rules at the reasoning layer.

AI Systems Control may invoke or present Development OS capabilities, but does not absorb its reasoning corpus.

### Conductor owns
- decomposition of work into executable steps;
- orchestration across agents/tools;
- run sequencing, resumption, and multi-step execution semantics.

AI Systems Control may originate governed Actions or objectives that Conductor executes, but does not become the orchestrator.

### Web Foundation owns
- reusable website/product primitives extracted from proven production sources;
- design/runtime primitives that can compound across websites;
- source-first extraction from CardForge or other mature implementations.

AI Systems Control may be built with the Web Foundation and may control projects that use it. The foundation is not part of the control-plane domain model.

## Founder verification boundary

The product must preserve a visible distinction between:
- machine-observed facts;
- inferred/normalized state;
- desired state declared by an operator or policy;
- proposed mutations;
- authorized mutations;
- reported effects;
- verified effects after reconciliation.

The owner must be able to tell which category a statement belongs to.

## Non-goals for the initial build
- replacing GitHub;
- replacing Development Intelligence;
- embedding Development OS as copied prompts/docs;
- replacing Conductor with a generic task engine;
- directly editing provider state from arbitrary UI controls;
- building the full reusable Web Foundation in this repository;
- hiding uncertainty behind a binary "healthy" label.

## Initial success condition

AI Systems Control is ready to expand beyond Slice A when a real GitHub-backed Project can be opened in a Workspace and the operator can see:
- what project this is;
- which systems/hosts are bound;
- what the system observes now;
- where that observation came from and how fresh it is;
- what desired state applies;
- what differs;
- which capabilities are available or blocked;
- what would require a governed Action rather than a direct tool call.

That establishes the trustworthy spine needed for later mutation and orchestration.
