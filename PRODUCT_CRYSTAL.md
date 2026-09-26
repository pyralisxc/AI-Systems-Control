# Product Crystal — AI Systems Control

Status: **Crystallized architecture v2 candidate**  
Original crystal: **2026-09-18**  
Re-crystallized: **2026-09-26**

## Product statement

AI Systems Control is the durable owner-control and orchestration plane for projects, accounts, specialist systems, provider connections, and temporary AI workers.

ASC makes one owner's authority legible and enforceable across increasingly capable agents without absorbing the specialist systems that provide project understanding or execution.

ASC is not "one giant agent." It is the deterministic supervisory substrate around agents.

## User problem

As agent capability grows, the owner's bottleneck shifts from typing every implementation detail to supervising many streams of work:

- project meaning evolves faster than any one chat can retain;
- agents and chats are temporary, but work and authority must survive them;
- specialist systems need overlapping provider identities and connections;
- a work item can be valid without being authorized;
- an agent can be technically able to act without being permitted to act;
- multiple personal/business identities must remain separated;
- the owner needs to know what is working, what needs attention, and how to stop it immediately;
- provider success, code integration, product acceptance, and owner authorization are different facts.

ASC exists to solve these supervisory and coordination failures.

## Domain center

The new control-plane center is:

1. **Owner / Account Domain** — who controls the system and which personal/business context applies.
2. **Project Reference** — durable identity and links to the project's authoritative systems.
3. **Connection** — an owner-authorized provider identity/installation/account available within an account domain.
4. **Work Authorization** — explicit owner verification that bounded work may proceed.
5. **Worker Session** — an ephemeral reasoning worker assigned to authorized work.
6. **Execution Lease** — short-lived authority for a worker to use specific capabilities.
7. **Control State** — running/paused/stopped state plus fencing generation used to revoke stale authority.
8. **Observation Link/Event** — references needed to reconstruct what happened without duplicating provider-native state.

Capabilities are discovered from specialist/execution systems and granted through ASC policy; ASC does not need to reimplement their behavior.

## System boundaries

### Project repository owns
- durable product direction and product-local documentation;
- architecture and design decisions;
- project-local legal/product constraints;
- code and version history;
- the project's own historical evolution.

ASC does not copy this meaning into a second canonical database.

### Development Intelligence owns
- evidence-backed machine understanding of project meaning and current reality;
- semantic/structural/representation relationships;
- provenance, uncertainty, coverage, and confidence semantics;
- parity/evaluation against caller-provided expectations;
- change and blast-radius evidence;
- historical comparison.

DI interprets project truth; it does not grant owner authority.

### Development OS owns
- reusable agent working method;
- exploration/resolution/crystallization practice;
- architecture-challenge behavior;
- verification/evidence discipline.

DevOS remains portable and should not require ASC/DI/Conductor to be useful.

### Conductor owns
- bounded execution and provider routing;
- exact code/deployment/provider mutations;
- repository work scope;
- idempotency/correlation and execution receipts;
- provider-specific execution mechanics.

ASC authorizes/observes execution; it does not duplicate Conductor's mechanics.

### AI Systems Control owns
- owner and account-domain identity;
- project-to-system relationships;
- provider connection/authorization brokerage;
- owner-verification records;
- worker/session registry;
- capability grants and leases;
- project/system control state;
- stop/revoke/fencing semantics;
- cross-system orchestration visibility;
- owner-facing exception/attention surfaces.

### Provider systems own
GitHub, Vercel, Google, Supabase, email providers, and future services remain authoritative for their own native state.

## Owner verification

Owner Verification is orthogonal to work lifecycle status.

A GitHub issue may be Ready but not Owner Verified. A PR may be green but not owner-accepted.

### Intent verification
The owner explicitly accepts a bounded work intent as eligible for implementation.

It binds to:
- project;
- work item or objective;
- reviewed scope/fingerprint;
- relevant project/DI revision references when needed;
- verification timestamp and owner identity;
- revocation/supersession state.

### Result verification
The owner explicitly accepts a resulting change for its next consequential boundary.

Repository merge state is not equivalent to product-direction acceptance.

## Worker control

Workers are replaceable and non-authoritative.

A worker may act only while:
- its work authorization is valid;
- its lease is unexpired;
- its project/system control generation still matches;
- the requested capability remains granted.

Owner stops are authoritative and cannot be auto-cleared by workers.

## Headless-first requirement

ASC must provide useful control before a rich cockpit exists.

A minimal first implementation should be observable through API/CLI and prove:
- project/account identity;
- owner verification;
- worker assignment/state;
- lease issuance/revocation;
- project/global stop;
- event reconstruction;
- no model required to read or enforce control state.

## Agent/session posture

ASC may eventually host conversational project agents and ephemeral work sessions, but normal ChatGPT consumer chats are not durable project truth.

Where supported, ASC may reference or ingest external chat context. It must not depend on undocumented access to consumer ChatGPT Projects.

## Non-goals

ASC does not:
- own product meaning for other projects;
- replace DI's graph/evidence engine;
- replace Conductor's execution/provider layer;
- replace GitHub issues/PRs with an ASC task database;
- require a continuously running LLM;
- treat merge-to-main as permanent product truth;
- infer owner authorization from work status;
- distribute raw long-lived provider credentials to workers;
- build a large dashboard before the control substrate is proven.

## Initial success condition

ASC v2 is ready to expand when one real Project can:
- belong to a defined account domain;
- reference its authoritative repository/DI/Conductor/provider surfaces;
- receive an explicit owner-verification record for a bounded work item;
- assign a worker session under a short-lived lease;
- revoke that worker at worker, project, or global scope;
- reconstruct the resulting orchestration state without copying provider-native truth;
- remain fully legible and stoppable with no LLM running.
