# AI Systems Control

AI Systems Control is the owner-facing control plane for connecting projects, workspaces, capabilities, and governed actions across the development system.

This repository crystallizes the architecture resolved in the Dev OS Outlook audit. It is intentionally a control plane, not a replacement for the specialist systems around it.

AI Systems Control is also the **canonical integrated owner-facing website** for those specialist systems. Development Intelligence, Development OS, Conductor, and future systems remain separate authorities behind explicit capability boundaries; ASC presents their capabilities as one coherent operating environment.

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

## Live Slice A owner entry point

Slice A can connect to a running Development Intelligence server through its public read-only MCP endpoint.

Requirements:
- Node.js 22+
- a reachable Development Intelligence deployment
- a valid DI bearer token when that deployment requires one

Run:

```bash
DEVINT_URL=http://127.0.0.1:8787 \
npm run slice-a -- pyralisxc/AI-Systems-Control
```

For an authenticated deployment:

```bash
DEVINT_URL=https://development-intelligence.example \
DEVINT_TOKEN=your-runtime-token \
npm run slice-a -- pyralisxc/AI-Systems-Control
```

Optional environment:
- `ASC_DESIRED_DEFAULT_REF=main` adds one owner desired-state claim for drift comparison.
- `ASC_FRESHNESS_WARNING_SECONDS=300` controls the aging threshold.
- `ASC_FRESHNESS_STALE_SECONDS=1800` controls the stale threshold.

The command prints the complete Slice A owner view as JSON: Project identity, Observed/Inferred/Desired truth, evidence and freshness, drift, problems, and read-capability binding availability. It exposes no provider mutation operation.

## Web and deployment ownership

ASC gets its own Vercel project in the existing Vercel team. The existing Development Intelligence Vercel project remains the independent evidence-service deployment. See [Hosting Topology](docs/HOSTING_TOPOLOGY.md) and [ADR-005/006](docs/adr/README.md).

Development Intelligence's direct Workbench remains a diagnostic/reference surface while routine intelligence workflows migrate into ASC.

## Core invariant

> No externally meaningful mutation occurs because a tool happens to be available. It occurs because an Action was proposed, evaluated by policy, explicitly authorized when required, executed through a capability binding, and reconciled into an Effect Receipt plus fresh observed state.

## Development status

**Slice A live integration in progress.** The control-plane spine, battle-test gates, and executable DI client/owner entry point are implemented. The remaining acceptance step is exercising this command against an actual reachable Development Intelligence deployment and preserving the resulting evidence that the real vertical slice works.
