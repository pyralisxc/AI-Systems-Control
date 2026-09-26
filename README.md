# AI Systems Control

AI Systems Control (ASC) is the owner-facing supervisory and orchestration plane for a network of projects, accounts, specialist systems, provider connections, and temporary AI workers.

ASC is deliberately **not** the source of product meaning, technical project intelligence, or provider execution logic. It connects those authorities, records owner authorization, observes active work, and preserves immediate owner control.

## System ownership

- **Project repositories** own durable product meaning: product direction, architecture, legal/product constraints, decisions, and project-local documentation.
- **Development Intelligence (DI)** owns evidence-backed machine understanding of project reality and meaning: semantic relationships, provenance, parity/evaluation, uncertainty, change interpretation, and historical comparison.
- **Development OS (DevOS)** owns reusable agent working method: how agents explore, challenge assumptions, resolve ambiguity, crystallize, build, and verify. DevOS remains portable and tool-neutral.
- **Conductor** owns bounded execution: exact code/provider/deployment operations, work scope, receipts, retries/idempotency, and execution mechanics.
- **GitHub and external providers** remain authoritative for their native state.
- **ASC** owns supervisory relationships: project/account identity, provider connections, owner authorization, worker/session state, capability grants, control state, stop/revocation, and cross-system visibility.
- **Agents/sessions** are ephemeral reasoning workers. They receive bounded context and capabilities and may be replaced without losing durable project truth or owner authority.

## Core authority rule

A work item being present, ready, technically feasible, or agent-recommended does not authorize implementation.

ASC introduces an owner-verification boundary:

- **Owner Verified — intent**: the owner has accepted the current bounded work intent as eligible for implementation.
- **Owner Verified — result**: the owner has accepted the resulting change for its next consequential boundary.

Verification is revocable and must bind to the exact scope/revision/fingerprint that was reviewed. Material changes require revalidation.

## Control rule

Owner control must not depend on model cooperation.

The target control plane supports:
- stop one worker;
- pause/stop one project;
- owner STOP ALL;
- short-lived worker/capability leases;
- fencing/control epochs so stale workers lose execution authority;
- lower-authority agents cannot clear an owner stop.

Workers receive scoped capabilities, not durable provider credentials.

## Product meaning

ASC does not maintain a second product-truth database.

Project-local documents and Git history remain durable product truth. DI interprets and evaluates that truth for machines. ASC may reference the relevant project/DI revision when authorizing work, but it does not become the author of project direction.

## Account and connection separation

ASC must support multiple owner context domains, such as personal and business contexts, with explicit project membership and provider identities. Connections and credentials must not bleed across domains merely because they belong to the same owner.

## Automation posture

Automation is a dial, not a cliff:

1. Owner verifies work and manually starts a worker.
2. Owner verifies work and ASC may dispatch a worker when capacity exists.
3. Only after those flows are proven should broader policy-driven derivation/dispatch be considered.

ASC must remain useful with no model running.

## Current implementation

The existing Slice A project-reality implementation is retained as historical/prototype evidence. It proved several valuable invariants—provenance, unknown/stale states, capability-versus-authorization separation—but its earlier product framing is superseded by the 2026-09-26 control-plane crystal.

See [PRODUCT_CRYSTAL.md](PRODUCT_CRYSTAL.md), [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md), [docs/DECISIONS_AND_DEFERRALS.md](docs/DECISIONS_AND_DEFERRALS.md), and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).
