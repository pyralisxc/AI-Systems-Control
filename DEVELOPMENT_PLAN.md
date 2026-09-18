# Development Plan

## Principle

Build the thinnest end-to-end control-plane spine that can tell the truth about one real project. Do not front-load a generic platform.

## Milestone 0 — Repository bootstrap
- establish package/runtime skeleton;
- add lint/type/test/verify gates;
- add architecture tests that guard direct provider mutation boundaries;
- encode the domain interfaces from docs/DOMAIN_MODEL.md;
- keep provider and specialist adapters behind ports.

Exit: repository can compile/test and the core contracts are executable types.

## Milestone 1 — Slice A: GitHub Project Reality
Implement in this order:

1. **Project identity**
   - canonical GitHub repository reference;
   - stable Project record;
   - deterministic lookup.

2. **Workspace**
   - open one Workspace over a Project;
   - store workspace-local context separately.

3. **Reality port**
   - define `ProjectRealityProvider`;
   - implement Development Intelligence adapter contract;
   - support unavailable/partial states.

4. **Observation model**
   - provenance;
   - timestamps/freshness;
   - explicit unknowns;
   - normalized project summary.

5. **Desired state + drift**
   - minimal declarative desired-state input;
   - aligned/divergent/unknown/incomparable/stale comparison.

6. **Capability catalog/bindings**
   - register observation capabilities;
   - resolve availability by host/provider/permission;
   - expose blocked reason.

7. **Owner view**
   - project identity;
   - observed state;
   - source/freshness;
   - desired state/drift;
   - capability availability.

8. **Slice A tests**
   - automate A01–A08, B01–B08 where applicable, C01–C08, and G01/G05;
   - assert no mutation adapter is reachable from Slice A.

Exit: real project reality is legible and trustworthy.

## Milestone 2 — Slice B: first governed Action
Choose one low-risk GitHub effect and implement the full Action -> policy -> authorization -> execution -> Receipt -> reconciliation loop.

Do not add several mutations at once.

## Milestone 3 — Conductor handoff
Connect a governed objective to Conductor while retaining Action/run/receipt correlation in AI Systems Control.

## Development issues to create
1. Slice A epic — GitHub Project Reality.
2. Bootstrap executable domain contracts and verification gates.
3. Development Intelligence reality adapter contract.
4. Observation + provenance + freshness model.
5. Desired-vs-observed drift engine.
6. Host-aware capability binding resolver.
7. Slice A owner view.
8. Slice A architecture/battle-test automation.

These issues are implementation decomposition, not new architecture.
