# Vertical Slices — ASC v2

The v2 system is built through small end-to-end control slices.

The 2026-09-18 Slice A project-reality implementation remains in the codebase as historical/prototype evidence. The following slices define the current target direction.

## Slice 1 — Owner Verification

### Goal
Prove that work lifecycle state and owner authorization are independent.

### Flow
1. Resolve one Project and one GitHub work item.
2. Observe that the work item may be Ready without being executable.
3. Record Owner Verified intent against an exact scope/fingerprint.
4. Re-read the authorization deterministically.
5. Revoke or invalidate it.

### Acceptance
- Ready does not imply authorized.
- authorization records owner, time, Project, work reference, and exact reviewed scope;
- material scope change does not silently inherit authorization;
- authorization can be revoked without changing the backing GitHub issue's meaning.

## Slice 2 — Worker Lease and Stop

### Goal
Prove one manually started worker can receive temporary authority and lose it immediately.

### Flow
1. Attach WorkerSession to an active WorkAuthorization.
2. Issue an ExecutionLease for a bounded capability set.
3. Execute/read a harmless test capability through the governed boundary.
4. Stop the worker or Project.
5. Increment/revoke the applicable control generation.
6. Attempt the stale operation again.

### Acceptance
- stale lease is rejected at the execution boundary;
- stopping does not depend on model cooperation;
- owner stop cannot be auto-cleared by a worker;
- ASC remains legible with no LLM running.

## Slice 3 — Account Domain / Connection Separation

### Goal
Prove personal and business identities cannot bleed into each other.

### Flow
1. Create two AccountDomains for one Owner.
2. Attach distinct provider Connection references.
3. Attach a Project to one domain.
4. Resolve capabilities/connections for that Project.
5. attempt cross-domain access.

### Acceptance
- only explicitly permitted connections are visible/usable;
- cross-domain capability use is denied unless explicitly authorized;
- raw provider secrets are not returned to workers.

## Slice 4 — Manual Conversational Worker

### Goal
Prove a natural-language session can operate over the control spine without becoming durable project truth.

### Inputs
- DevOS working method;
- Project-local truth through DI;
- Owner Verified work;
- scoped Conductor capabilities;
- ASC lease/control state.

### Acceptance
- session can be replaced without losing work/authorization/control state;
- complex project truth is retrieved from DI/project sources rather than transcript archaeology;
- owner can stop the session through ASC;
- transcript is evidence/context, not canonical project meaning.

## Slice 5 — Controlled Dispatch

### Goal
Allow ASC to start a worker for already Owner Verified work when explicit dispatch policy permits.

### Acceptance
- dispatch does not create new authorization;
- capacity/scheduling policy is deterministic and inspectable;
- ambiguous product/scope changes return to owner attention;
- global/project stop prevents new dispatch as well as ongoing execution.

## Later slices

Only after the above are proven:
- recurring/scheduled agent work;
- richer portfolio orchestration;
- browser execution;
- stronger conversational cockpit;
- policy-derived candidate work;
- multi-user/organization administration.
