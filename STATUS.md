# Status

Date: **2026-09-26**

## Phase
**Re-crystallized -> headless control-spine candidate**

## Repository baseline
- Repository: `pyralisxc/AI-Systems-Control`
- Current accepted `main` at crystallization start: `36c9162d94b974500535ce211aa018512432485c`
- Original crystal: 2026-09-18
- Architecture v2 exploration/crystallization: 2026-09-26
- Canonical architecture work item: #24

## Current decisions
- ASC is a supervisory/orchestration/control plane, not the source of project meaning.
- Project repositories own durable project/product meaning.
- DI owns evidence-backed machine understanding of project reality/meaning.
- DevOS owns portable agent working method.
- Conductor owns bounded execution/provider mechanics.
- GitHub/providers retain native-state authority.
- Owner Verification is distinct from Ready/In Progress/Review and from merge state.
- Worker authority is temporary, revocable, and lease/fence based.
- ASC must provide worker/project/global stop controls that do not depend on model cooperation.
- ASC is headless-first; a rich cockpit is downstream of proven control semantics.
- Personal/business account domains and provider identities must be explicitly separated.
- Normal chat transcripts are not durable project truth.

## Existing implementation
The current Slice A code is retained as useful prototype evidence. Its provenance/uncertainty/capability-boundary work may be reused, but the old Project/Workspace/Desired-State/Action center is no longer the target product model.

## Next gate
Resolve and implement the smallest headless slice that proves:
1. account/project identity;
2. owner-verification record;
3. worker/session registry;
4. execution lease + fencing generation;
5. worker/project/global stop;
6. minimal event reconstruction.

No autonomous dispatch is required for this gate.

## Repository flow note
ASC currently has no `preview` / `vercel-preview` branch. Architecture changes should remain on bounded `work/*` branches until the integration lane is established; Main remains gated.
