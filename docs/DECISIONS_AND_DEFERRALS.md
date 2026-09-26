# Decisions, Deferrals, and Rejected Directions

## Accepted — 2026-09-26 crystal

- ASC is a supervisory/orchestration/control plane, not the source of project meaning.
- Project repositories own durable product direction, architecture, constraints, and project-local decisions.
- DI owns evidence-backed machine understanding of project reality/meaning, parity, provenance, uncertainty, and change interpretation.
- DevOS owns portable agent working method and should not be hard-wired to this tool stack.
- Conductor owns bounded execution/provider mechanics, receipts, retries, and exact mutation scope.
- GitHub and provider systems remain authoritative for their native state.
- Owner Verification is separate from issue/PR lifecycle status and from merge state.
- Owner Verification binds to exact reviewed scope/revision/fingerprint and is revocable.
- Workers are ephemeral and receive short-lived scoped capability leases rather than durable provider credentials.
- Worker/project/system stops must be enforced by deterministic control state/fencing, not model cooperation.
- Lower-authority agents cannot clear an owner stop.
- ASC is headless-first; a rich cockpit is built after control semantics are proven.
- ASC should support multiple account domains/identities, including personal/business separation.
- Chat transcripts are not durable project truth.
- Existing Slice A code is retained as prototype evidence until a bounded v2 migration proves what to reuse.

## Superseded from the 2026-09-18 crystal

The following are no longer accepted as ASC's product center:
- ASC as the canonical integrated UI for every specialist capability;
- ASC owning project Desired State as a separate canonical product-intent store;
- ASC owning the complete Action -> provider execution -> Effect Receipt lifecycle;
- Project/Workspace/Capability/Action as the frozen universal domain center;
- migration of routine DI workflows into ASC as a product requirement.

Useful invariants from that work remain and should be preserved where relevant.

## Deferred

- automatic dispatch of Owner Verified work;
- policy-derived creation of executable work from broad project direction;
- rich multi-project cockpit;
- general scheduling/recurring agent work;
- multi-user organization administration beyond architecture compatibility;
- browser execution provider;
- cost/budget allocation policy;
- external commercialization/marketplace semantics;
- direct integration with consumer ChatGPT Project chat history unless an official supported interface exists.

Deferred means not required for the first control spine, not rejected.

## Rejected

- ASC as a second DI/project-truth database;
- ASC as a second Conductor/provider executor;
- replacing GitHub Issues/PRs with an ASC task database;
- granting execution because a work item is Ready;
- granting execution because a tool is available;
- giving autonomous workers permanent provider credentials;
- making an LLM necessary to read/enforce control state;
- relying on prompt instructions as a kill switch;
- treating merge-to-main as permanent product-direction acceptance;
- silently broadening credentials/connections after permission failure;
- automatically mixing personal/business provider context.

## Change rule

A future change to an Accepted decision should include:
1. owner-visible rationale;
2. DI/evidence-backed impact analysis where applicable;
3. migration consequences for existing control state;
4. an ADR/amendment when authority boundaries change.
