# Owner Experience

## Product posture

The primary experience is an owner/operator console: one place to understand what exists, what is connected, what differs from intent, what can be done, and what requires explicit authorization.

The console should optimize for legibility before density.

## Project view

Every Project view should answer, without opening specialist tools:
- What project am I looking at?
- Which source/reality references identify it?
- What is the latest observed state?
- How fresh is that observation?
- What desired state applies?
- What is aligned, drifting, unknown, or stale?
- Which systems are currently reachable?
- Which capabilities are available, unavailable, or permission-blocked?
- What Actions are pending, executing, failed, or awaiting verification?

## Workspace view

A Workspace is where the owner works with a Project. It may change the lens without changing the underlying truth.

Expected controls:
- environment/host selector;
- objective/context;
- capability palette;
- desired-state overlay;
- evidence/source drawer;
- Action queue;
- escalation queue;
- receipts/history.

## Truth presentation

The UI must visually distinguish:
- **Observed** — backed by current evidence.
- **Desired** — declared intent.
- **Inferred** — normalized/interpreted by a specialist system.
- **Proposed** — would change external state if authorized/executed.
- **Reported** — executor/provider says an effect occurred.
- **Verified** — fresh observation confirms the effect.

Do not collapse these categories into one "status" badge.

## Permission escalation

If a capability exists but cannot be realized:
1. show the capability as known but blocked;
2. show the concrete reason when available;
3. produce an escalation requirement, not an improvised workaround;
4. after permission changes, re-resolve the binding rather than assuming success.

## Founder verification

For high-impact or boundary-changing Actions, the owner sees:
- exact target;
- requested change;
- provider/host;
- why the Action is needed;
- policy decision;
- expected effect;
- verification plan.

The control plane should make it easier to approve a well-specified Action than to perform an opaque direct mutation.

## Progressive depth

Default views show the operator model. Evidence, provider payloads, and specialist-system details remain inspectable one level deeper. This keeps the system approachable without discarding rigor.
