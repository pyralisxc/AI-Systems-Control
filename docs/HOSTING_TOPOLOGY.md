# Hosting Topology — ASC v2

Status: **architecture direction; deployment details remain reversible**  
Revised: **2026-09-26**

## Boundary

ASC, DI, Conductor, and product applications are independent authorities and should retain independent failure/deployment boundaries where they are separately deployed.

ASC is not the canonical product UI for DI or other specialist systems. It is the supervisory/control surface that may link to or project their state.

## Current topology

```text
Owner
  |
  v
ASC
(identity / accounts / connections / authorization / worker control)
  |
  +--> DI
  |    (project understanding / evidence / parity)
  |
  +--> Conductor
  |    (bounded execution / provider effects)
  |
  +--> Agent runtime(s)
  |    (ephemeral reasoning sessions)
  |
  +--> Provider/account connections
       (GitHub, Vercel, Google, Supabase, ...)
```

Project applications such as CardForge remain independent systems.

## Deployment posture

Separate deployments are preferred when systems have independent:
- authority;
- release cadence;
- secrets/connections;
- scaling behavior;
- rollback needs;
- failure modes.

Do not merge services merely to make them feel like one cockpit.

## ASC durable control state

ASC control state is behind the provider-neutral `ControlRegistryStore` contract.

Current adapters:
- JSON-file storage for a persistent local/self-hosted server volume;
- PostgreSQL storage for hosted/serverless or self-hosted Postgres.

The Postgres adapter uses standard PostgreSQL semantics rather than a vendor-specific API, so deployment may use a compatible managed provider or a future owner-operated database without changing ASC domain contracts.

Ephemeral function filesystem storage is not an acceptable authority store.

## Authentication and connections

Human owner authentication belongs at ASC's control boundary when using ASC.

Provider credentials/connections are brokered server-side and scoped by AccountDomain/Project/lease. Browser code and workers should receive capability handles or short-lived delegated authority rather than raw long-lived secrets.

Specialist systems may keep independent authentication for their direct clients.

### ChatGPT / MCP OAuth topology

```text
ChatGPT / MCP client
       |
       | OAuth 2.1 / bearer token
       v
external authorization server / IdP
       |
       | signed access token
       v
ASC /mcp resource server
       |
       +--> issuer+subject -> Principal
       +--> token AccountDomain -> active Membership
       +--> tenant-scoped Thread / control services
```

ASC publishes protected-resource metadata and verifies tokens but does not issue them.

The authorization server must support the MCP/OpenAI OAuth client flow used by the target host, including appropriate discovery/PKCE/resource-audience behavior. Provider choice remains a deployment adapter decision.

## Failure posture

- ASC unavailable: specialist systems may remain independently usable; no new ASC-mediated authorization/dispatch occurs.
- DI unavailable: project understanding becomes unavailable/stale; ASC must not invent replacement semantic truth.
- Conductor unavailable: execution becomes unavailable; ASC must not substitute an ungoverned direct mutation path.
- Agent runtime unavailable: deterministic ASC control state remains readable and stoppable.

## UI posture

ASC may eventually provide a rich cockpit, but specialist UIs do not need to migrate into ASC. Deep links/projections are valid long-term boundaries.

## Current web shell

The existing Next.js shell remains a prototype client from the 2026-09-18 Slice A architecture. It may be reused selectively, but it does not define v2 ownership or navigation.
