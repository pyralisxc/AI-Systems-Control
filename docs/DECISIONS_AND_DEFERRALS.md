# Decisions, Deferrals, and Rejected Directions

## Accepted — 2026-09-26/27 crystal

- ASC is a supervisory/orchestration/control plane, not the source of Project meaning.
- Project repositories own durable product direction, architecture, constraints, and project-local decisions.
- DI owns evidence-backed machine understanding of Project reality/meaning, parity, provenance, uncertainty, and change interpretation.
- DevOS owns portable agent working method and should not be hard-wired to this tool stack.
- Conductor owns bounded execution/provider mechanics, receipts, retries, and exact mutation scope.
- GitHub and provider systems remain authoritative for their native state.
- Personal mode and enterprise mode share one identity/authority architecture.
- Principal is the stable actor identity; Owner is an AccountDomain Membership role, not ASC's identity root.
- AccountDomain is the primary tenant/security boundary unless later evidence justifies a higher organization grouping layer.
- Human and service Principals are distinct and auditable.
- Authentication identity, AccountDomain Membership, and authorization are separate concerns.
- Tenant control state is partitioned by AccountDomain; normal tenant requests do not load unrelated tenants.
- Connections belong to AccountDomains and retain the Principal that authorized them.
- Owner Verification is separate from issue/PR lifecycle status and from merge state.
- Personal "Owner Verified" UX maps to Principal approval/policy-backed WorkAuthorization.
- Workers are ephemeral and receive short-lived scoped capability leases rather than durable provider credentials.
- Worker/Project/system stops are enforced by deterministic control state/fencing, not model cooperation.
- Lower-authority agents cannot clear an owner-level stop.
- ASC is headless-first; a rich cockpit is built after control semantics are proven.
- Chat transcripts are not durable Project truth.
- Existing Slice A code is retained as prototype evidence until bounded migration proves what to reuse.
- WorkEnvelope is the versioned bounded continuation contract; it cannot expand underlying WorkAuthorization.
- Autonomy is dated and scoped per Project/work class, not a global model/user trust score.
- Effective autonomous authority is the intersection of WorkEnvelope, AutonomyGrant, WorkAuthorization where required, and ControlState.
- Repository ceilings are explicit; high autonomy does not silently widen Preview to Main.
- Owner STOP and explicit owner gates outrank all autonomy grants.
- Autonomy can regress or require review without changing Project meaning.
- Founder Relay proposals are interaction state, not owner-authored Project truth.
- Owner approval/edit of a Relay produces owner-assisted provenance; it does not rewrite the original proposal as literal human authorship.
- Founder Relay auto-send always performs a fresh continuation-authority evaluation at delivery time.
- `auto_sent` requires confirmed delivery through an idempotent send-capable transport; policy permission alone is not delivery.
- External/bridged Threads that ASC cannot send into surface manual owner handoff instead of fabricated steering.
- Relay calibration is derived from explicit feedback/outcomes rather than arbitrary chat text.
- Pending Relay suggestions may affect proposal counts but do not affect settled calibration evidence fingerprints.
- Calibration readiness can propose an owner autonomy review but never creates or widens an AutonomyGrant automatically.

## Superseded from earlier crystal

No longer accepted as ASC's product center:
- ASC as canonical integrated UI for every specialist capability;
- ASC owning Project Desired State as a separate canonical product-intent store;
- ASC owning the complete Action -> provider execution -> Effect Receipt lifecycle;
- Project/Workspace/Capability/Action as the frozen universal domain center;
- one singular Owner object as the root identity/authority model;
- one global `primary` hosted control-registry document.

Useful invariants from earlier work remain where relevant.

## Deferred

- automatic dispatch of Owner Verified work;
- policy-derived creation of executable work from broad Project direction;
- rich multi-project cockpit;
- general scheduling/recurring agent work;
- multi-user administration UI;
- invitations/groups UI;
- OIDC/SAML enterprise setup UI;
- SCIM provisioning;
- custom role editor;
- enterprise billing/seats/compliance exports;
- browser execution provider;
- cost/budget allocation policy;
- external commercialization/marketplace semantics;
- direct integration with consumer ChatGPT Project chat history unless an official supported interface exists.

Deferred means not required for the first control spine, not rejected.

## Rejected

- ASC as a second DI/Project-truth database;
- ASC as a second Conductor/provider executor;
- replacing GitHub Issues/PRs with an ASC task database;
- granting execution because a work item is Ready;
- granting execution because a tool is available;
- giving autonomous workers permanent provider credentials;
- making an LLM necessary to read/enforce control state;
- relying on prompt instructions as a kill switch;
- treating merge-to-main as permanent product-direction acceptance;
- silently broadening credentials/connections after permission failure;
- automatically mixing personal/business provider context;
- using email as canonical Principal identity;
- making enterprise mode a separate domain model from personal mode;
- a global "trusted AI" autonomy flag;
- model-confidence-based authorization;
- allowing autonomy level to widen repository/effect scope beyond an explicit WorkEnvelope;
- presenting generated Relay text as if the represented human literally authored it;
- marking a Relay auto-sent when no transport actually delivered it;
- treating accepted/edited Relay calibration as canonical Project intent.

## Change rule

A future change to an Accepted decision should include:
1. owner-visible rationale;
2. DI/evidence-backed impact analysis where applicable;
3. migration consequences for existing control state;
4. an ADR/amendment when authority boundaries change.
