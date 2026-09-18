# Architecture Decision Records

## ADR-001 — Control plane, not monolith
**Decision:** AI Systems Control owns control semantics while Development Intelligence, Development OS, Conductor, and Web Foundation remain separate authorities.  
**Reason:** specialist ownership preserves clarity, independent evolution, and evidence boundaries.  
**Consequence:** integrations require explicit interfaces; duplicated specialist logic is an architecture defect.

## ADR-002 — Desired and observed state are separate
**Decision:** desired state is never stored as if it were current external reality.  
**Reason:** control requires visible drift and uncertainty.  
**Consequence:** every comparison must support unknown/stale/incomparable outcomes, not just equal/not-equal.

## ADR-003 — Govern mutations through Actions and Effect Receipts
**Decision:** externally meaningful mutations enter the Action lifecycle and finish only after reconciliation.  
**Reason:** tool execution, authorization, and real-world effect are different facts.  
**Consequence:** provider success cannot directly produce "verified."

## ADR-004 — Source-first Web Foundation extraction
**Decision:** reusable website primitives are extracted from mature source systems after ownership seams are established.  
**Reason:** cumulative development should preserve proven behavior without freezing product-specific accidental architecture into a generic foundation.  
**Consequence:** AI Systems Control can consume the foundation but does not own it.
