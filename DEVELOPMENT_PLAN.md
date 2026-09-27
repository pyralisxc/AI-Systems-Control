# Development Plan

## Principle

Build the smallest deterministic control spine that can authorize, observe, and stop one real worker on one real Project.

Do not front-load a dashboard, autonomous scheduler, generic task engine, or duplicated specialist logic.

## Phase 0 — Architecture reconciliation

- replace the 2026-09-18 canonical-owner-console framing;
- preserve useful existing code and invariants;
- establish the new ownership boundaries;
- keep historical decisions explicit rather than silently rewriting them.

Exit: repository documentation describes one coherent supervisory-control product.

## Phase 1 — Owner authorization spine

Implement the minimum durable contracts for:
- AccountDomain;
- ProjectReference / ProjectMembership;
- WorkAuthorization (Owner Verified);
- exact scope/revision/fingerprint binding;
- revocation/supersession/invalidation.

Use GitHub issues/PRs as durable work objects; do not create an ASC task database.

Exit: a Ready issue is still non-executable until an explicit owner authorization exists.

## Phase 2 — Worker control spine

Implement:
- WorkerSession registry;
- ExecutionLease;
- capability scope;
- expiry;
- parent/child worker relationship when needed;
- control generation/fencing;
- Worker stop;
- Project pause/stop;
- Owner STOP ALL;
- authoritative owner-stop semantics.

No autonomous worker is required yet; a human-invoked/manual test worker is enough.

Exit: stale/revoked workers cannot use mutable capabilities even if they keep running.

## Phase 3 — Account and connection brokerage

Implement the smallest provider-connection model that supports:
- personal/business account-domain separation;
- multiple identities/installations for the same provider;
- explicit Project membership/binding;
- scoped downstream capability handles;
- no raw credential exposure to workers.

Avoid duplicating provider-native state.

## Phase 4 — Observation and reconstruction

Represent the minimum references/events needed to answer:
- what workers are active;
- what authorized work they are attached to;
- what capabilities/leases they hold;
- what stopped/blocked/completed;
- where provider/DI/GitHub evidence can be inspected.

Prefer references to authoritative systems over copied state.

## Phase 5 — Manual conversational worker

Connect one manually started ephemeral agent session to:
- relevant DevOS method;
- project-local documentation through DI;
- authorized work;
- bounded Conductor capabilities;
- ASC lease/control state.

Prove natural-language interaction without autonomous dispatch.

## Phase 6 — Controlled dispatch

Only after manual operation is reliable:
1. allow owner-verified work to be queued;
2. allow ASC to dispatch when explicit policy/capacity permits;
3. stop at product ambiguity, scope invalidation, hard policy boundaries, or owner stop.

Do not derive new executable work from broad project intent in the first automation tranche.

## UI / cockpit

The cockpit is a projection over proven control semantics, not the architecture foundation.

Likely owner surfaces:
- Needs You;
- Working;
- Projects / Account Domains;
- Connections;
- Worker/control status;
- live conversational agent;
- expandable DI/provider evidence.

Build this only after the headless control spine is trustworthy.
