# Architecture Decision Records

## ADR-001 — Control plane, not monolith
**Decision:** ASC owns supervisory control semantics while DI, DevOS, Conductor, GitHub, and providers remain separate authorities.  
**Reason:** specialist ownership preserves clarity, independent evolution, and enforceable boundaries.  
**Consequence:** duplicated specialist logic in ASC is an architecture defect.

## ADR-002 — Project meaning stays with the Project
**Decision:** durable product direction, principles, architecture, constraints, and project-local decisions remain in the Project's own repository/history.  
**Reason:** moving project meaning into ASC would create a second truth and detach evolution from the project itself.  
**Consequence:** ASC stores references/authorization; DI interprets and evaluates project meaning from authoritative sources.

## ADR-003 — DI owns machine understanding, not owner authority
**Decision:** DI is the evidence-backed project-understanding layer for semantic meaning, parity, provenance, uncertainty, and blast-radius evidence.  
**Reason:** general agents should not repeatedly reconstruct project truth from raw files/chat history.  
**Consequence:** ASC and workers consume DI evidence but must not treat DI as owner authorization or omniscient certainty.

## ADR-004 — Owner Verification is independent of work status
**Decision:** issue/PR lifecycle status does not authorize execution. Owner Verification is a separate, revocable record bound to exact reviewed scope/revision/fingerprint.  
**Reason:** Ready/In Progress/green CI answer different questions than "did the owner authorize this work/result?"  
**Consequence:** agents cannot infer authority from status, historical behavior, or technical feasibility.

## ADR-005 — Worker authority is leased and fenceable
**Decision:** workers receive short-lived capability leases bound to control generations; owner stop increments/revokes authority so stale workers cannot mutate state.  
**Reason:** a real kill switch must work even when a model/process does not cooperate.  
**Consequence:** autonomous workers must not hold unmediated long-lived provider credentials.

## ADR-006 — Conductor owns bounded execution
**Decision:** exact provider/code/deployment mutation mechanics, receipts, retries/idempotency, and execution scope belong to Conductor.  
**Reason:** duplicating these mechanics in ASC creates competing execution authorities.  
**Consequence:** ASC authorizes/observes; Conductor executes.

## ADR-007 — DevOS is portable agent method
**Decision:** DevOS defines reusable agent working behavior without being hard-wired to ASC/DI/Conductor.  
**Reason:** methodology should remain useful outside this owner's current tool stack.  
**Consequence:** ASC may select/supply DevOS method to workers but does not absorb its reasoning corpus.

## ADR-008 — Headless control before cockpit
**Decision:** prove owner verification, worker registry, leases, stops, and event reconstruction through deterministic interfaces before expanding the rich UI.  
**Reason:** presentation must not substitute for enforceable control.  
**Consequence:** the first v2 implementation slice may be API/CLI-first.

## ADR-009 — Account domains separate identities and connections
**Decision:** personal/business contexts are explicit AccountDomains; Projects and provider Connections are scoped to them.  
**Reason:** one owner can operate multiple businesses/accounts without granting every worker access to every identity.  
**Consequence:** cross-domain capability use requires explicit authorization.

## Historical decisions

The 2026-09-18 ADRs around Desired State, Action/Effect Receipt ownership, canonical specialist UI, and separate ASC/DI deployment captured useful early reasoning but no longer define the v2 product center.

Their durable invariants remain:
- observed evidence needs provenance;
- unknown/stale/indeterminate are valid;
- tool availability is not authorization;
- provider success is not independently verified reality.

Historical source remains available in Git history.
