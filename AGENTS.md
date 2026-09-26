# Agent Operating Contract — ASC v2

Agents working in this repository must preserve the 2026-09-26 supervisory-control boundary.

## Before changing code

1. Read PRODUCT_CRYSTAL.md, docs/DOMAIN_MODEL.md, and relevant ADRs.
2. Identify the authoritative owner for each behavior:
   - project meaning -> project repository;
   - machine project understanding -> DI;
   - reusable agent method -> DevOS;
   - bounded execution/provider mechanics -> Conductor;
   - native work/code/provider state -> GitHub/providers;
   - owner authorization/orchestration/control -> ASC.
3. Apply the authority placement test: if another bounded system owns the semantics, ASC should normally hold only a reference, authorization, correlation, or control relationship to it.
4. Prefer the smallest headless vertical slice that proves an authority/control invariant.
5. Use DI to inspect current implementation before duplicating or replacing existing behavior.

## Hard rules

- Do not move state or behavior into ASC merely because ASC needs to display, authorize, or route it.
- Do not create a second product-truth/intention database in ASC.
- Do not copy DI graph/evidence logic into ASC.
- Do not copy Conductor provider/execution logic into ASC.
- Do not replace GitHub Issues/PRs with an ASC task store.
- Do not duplicate provider-native state when an authoritative reference/read is sufficient.
- Do not infer Owner Verification from Ready/In Progress/Review/green CI/merge state.
- Do not allow material changes to inherit stale owner authorization.
- Do not give workers long-lived raw provider credentials.
- Do not implement stop/revocation as a prompt-only convention.
- Do not allow lower-authority agents to clear an owner stop.
- Do not make an LLM necessary for deterministic control state.
- Do not silently mix personal/business account-domain context.
- Do not assume consumer ChatGPT chats are programmatically available without a supported interface.

## Development method

- Explore/resolve/crystallize architecture changes before implementation.
- Preserve project/provider authority boundaries.
- Prefer references to external truth over copied state.
- Make authorization, leases, revocation, and uncertainty explicit.
- Add adversarial tests for control semantics.
- Keep Main gated; ordinary work should flow through an integration/Preview lane once that branch exists.

## Review question

Every PR should answer:

**What owner-control/orchestration invariant does this change establish or preserve, and why does the implemented state belong in ASC rather than an existing bounded system?**
