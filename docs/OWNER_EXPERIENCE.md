# Owner Experience — ASC v2

## Product posture

ASC is an owner-control cockpit over independently authoritative systems.

The owner experience should optimize for:
1. what needs the owner;
2. what is currently working;
3. what is connected/authorized;
4. how to stop it immediately;
5. where to inspect deeper evidence when needed.

ASC is not required to reproduce every specialist UI.

## Default cockpit questions

A Project view should quickly answer:
- What Project/account domain am I controlling?
- Which provider identities/connections are in scope?
- What work is Owner Verified?
- Which workers are active, on what work, and under which leases?
- What is waiting for owner verification/review?
- Are any workers or projects paused/stopped?
- Which capabilities are currently available or blocked?
- Where is the underlying DI/GitHub/Conductor/provider evidence?
- Can I stop the worker/project/system immediately?
- What WorkEnvelope currently bounds this Thread/work?
- Which work classes are allowed to continue automatically, at what dated autonomy level, and up to which repository boundary?

## Needs You

Owner attention should be exception-driven.

Examples:
- candidate work awaiting Owner Verification;
- material scope/intent ambiguity;
- authorization requiring revalidation;
- result awaiting consequential acceptance;
- permission/connection escalation;
- worker blocked outside its verified scope.

Ten successful background steps should not create ten owner notifications.

## Bounded autonomy

The owner experience should not present one global "autonomy" toggle.

For each Project/work class, ASC should be able to explain:
- the active WorkEnvelope;
- the dated AutonomyGrant and level;
- the repository ceiling;
- whether mutable authority is backed by current WorkAuthorization;
- when the grant was last proven / must be reviewed;
- why the next proposed continuation is allowed, needs the owner, or is blocked.

A normal progression is Observe → Suggest → Continue → Integrate → Operate, but grants remain reversible and scope-specific.

A Project or lane may be evidence-saturated without being creatively finished; saturation is a reason to stop the current search, not authorization to invent additional work.

## Founder Relay

Founder Relay should begin as an owner-review loop before it becomes automatic.

Suggested Relay UX:
- show the immutable proposed continuation;
- show why ASC proposed it and the current authority result;
- let the represented human Principal Approve, Edit, or Reject;
- retain edits/rejections as calibration evidence;
- label approved/edited drafts as owner-assisted;
- label a Relay as auto-sent only after current authority permits it and a real transport confirms delivery.

For an external ChatGPT/other consumer Thread that ASC cannot send into, an authorized Relay becomes a manual owner handoff. Pulse should surface Needs You rather than claiming the chat was steered.

The owner should be able to understand:
- who the Relay represents;
- which service generated it;
- which WorkEnvelope/AutonomyGrant/WorkAuthorization supported it;
- whether it was merely suggested, owner-assisted, rejected, or actually auto-delivered.

Relay calibration should learn from accepted/edited/rejected continuation behavior, not turn every conversation sentence into a durable personality or Project-intent model.

### Relay calibration evidence

ASC may derive deterministic interaction-calibration evidence per represented Principal + AccountDomain + Project + work class.

Useful owner-facing measures include:
- explicit response count;
- unchanged approvals;
- edits;
- rejections;
- actual auto-send outcomes;
- acceptance/edit/rejection rates;
- bounded deterministic edit magnitude;
- latest evidence time;
- stable evidence fingerprint/reference.

A pending Relay may count as a proposal, but it must not alter the calibration evidence fingerprint until the owner responds or a real auto-send outcome exists.

Thresholds may surface an **autonomy review candidate** such as "47/49 accepted; review Continue authority?" The owner still decides. Calibration must never create or widen an AutonomyGrant automatically.

The first earned-autonomy owner action is deliberately narrow: the represented Principal may explicitly convert review-ready calibration into Level 2 (Continue) with a read-only repository ceiling. The server recomputes calibration from durable Relay evidence at click time and records the stable evidence reference/fingerprint on the grant.

That action does not create a WorkEnvelope, WorkAuthorization, or mutation authority. A matching WorkEnvelope remains required before automatic continuation can actually proceed, and Integrate/Preview/Main authority requires separate explicit decisions.

One Principal's calibration never trains another Principal's owner-channel behavior.

## Working

Show active and recently completed workers with:
- project;
- authorized work;
- worker/session identity;
- state;
- lease/capability scope;
- latest meaningful event;
- stop control.

## Conversational control

ASC should support a natural-language project/control agent without requiring formal ticket syntax.

A lightweight model may be sufficient for:
- reading deterministic ASC state;
- querying DI;
- moving/updating work through allowed operations;
- explaining blockers;
- invoking stop/pause/verification commands.

Complex product/architecture reasoning may escalate to a stronger worker.

The conversation is an interface to durable systems, not the durable source of project truth.

## ChatGPT and external chats

ASC may reference/ingest external chats when a supported interface exists, but normal consumer ChatGPT Project chats must not be assumed to be programmatically readable/writable.

ASC-managed agent sessions are a separate future execution surface.

## Progressive depth

Default views remain compact.

DI graph detail, provider payloads, logs, PRs, deployment evidence, and historical events are available one level deeper rather than duplicated into the main cockpit.

## Account-domain separation

Personal and business contexts must remain visually and technically distinct.

A worker for a business Project must not implicitly gain access to the owner's personal Google/email/provider context.

Cross-domain access requires explicit authorization.
