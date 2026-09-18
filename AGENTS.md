# Agent Operating Contract

Agents working in this repository must preserve the crystallized system boundary.

## Before changing code
1. Identify which domain owner the requested behavior belongs to.
2. Read PRODUCT_CRYSTAL.md and the relevant ADR/battle tests.
3. Confirm the change does not duplicate Development Intelligence, Development OS, Conductor, or Web Foundation ownership.
4. Prefer the smallest vertical-slice change that preserves end-to-end truth.

## Hard rules
- Do not add direct provider mutation paths outside the Action pipeline.
- Do not treat tool availability as authorization.
- Do not mark effects verified from provider responses alone.
- Do not erase unknown/stale/indeterminate states for UI convenience.
- Do not copy specialist-system implementation into this repository to avoid an integration.
- Do not create a second Project truth inside a Workspace.
- Do not silently broaden credentials after a permission failure.
- Do not build generic web primitives here merely because the UI needs them.

## Development method
- Slice A first: GitHub Project Reality.
- Add contracts/interfaces before provider-specific logic leaks inward.
- Carry evidence/freshness through the stack.
- Add or update battle tests when semantics change.
- Add an ADR when changing a frozen architectural decision.
- Keep migrations explicit and delete superseded active paths after parity.

## Review question
Every PR should be answerable in one sentence:
**What control-plane invariant does this change establish or preserve?**
