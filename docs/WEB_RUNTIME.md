# ASC Web Runtime

Status: **existing prototype shell; v2 cockpit deferred**

## Existing implementation

The repository currently contains a Next.js App Router / Node 22 shell created for the 2026-09-18 Slice A architecture.

It includes:
- owner authentication;
- project selection;
- a DI-backed project-reality route;
- a Project Workspace view;
- read-only reality/freshness/drift/capability presentation.

This code is retained as working prototype evidence. It does not define ASC v2's product center.

## v2 rule

Headless control semantics come before cockpit expansion.

Do not expand the current Project Workspace into the new ASC product until the following are proven independently:
- AccountDomain/Project identity;
- Owner Verification;
- WorkerSession registry;
- ExecutionLease/fencing;
- worker/project/global stop;
- event reconstruction;
- connection/identity separation.

## Runtime separation

Core control contracts must remain usable without React/Next.

The existing split between compiled core and web client is compatible with this principle and may be retained if it remains useful.

## Security

- owner/control endpoints require authenticated owner authority;
- secrets remain server-side;
- workers receive scoped/short-lived capability authority;
- account-domain boundaries must be enforced server-side;
- stop/revocation cannot depend on UI state or model cooperation.

## Future cockpit

A future UI may project:
- Needs You;
- Working;
- Projects / Account Domains;
- Connections;
- worker/control state;
- conversational project/control agent;
- links into DI/GitHub/Conductor/provider evidence.

The UI must remain a projection over deterministic control state rather than becoming its own authority.
