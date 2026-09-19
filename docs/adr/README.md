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


## ADR-005 — ASC owns the canonical integrated owner surface
**Decision:** AI Systems Control is the canonical human/product surface for routine use of specialist development systems. Development Intelligence remains a separate evidence engine; its Workbench becomes a diagnostic/reference surface rather than the primary integrated owner application.  
**Reason:** maintaining multiple equally primary owner websites duplicates navigation, authentication, product composition, and presentation work while fragmenting the control-plane experience. ASC can present specialist capabilities deeply without taking ownership of their truth engines.  
**Consequence:** DI capabilities migrate into ASC progressively with evidence/parity preserved. Specialist UIs remain available until equivalent ASC access is battle-tested. ASC must never reimplement DI graph/evidence semantics merely to render them.

## ADR-006 — Separate Vercel projects for ASC and DI
**Decision:** AI Systems Control receives its own Vercel project in the existing Vercel team. The existing `development-intelligence` Vercel project remains the DI service deployment.  
**Reason:** the canonical website and the specialist evidence service have different deployment, rollback, scaling, authentication, and failure domains. Reusing one Vercel project would couple releases and blur service ownership.  
**Consequence:** ASC may call DI over a private/trusted service boundary, but each system keeps independent deployments. Shared domains/design systems may make them feel like one product without sharing a deployment unit.
