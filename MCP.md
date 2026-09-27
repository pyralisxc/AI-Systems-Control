# MCP / Tool Surface Contract

AI Systems Control exposes/consumes tool capabilities as adapters to ASC domain authority, never as an alternate authority model.

## Current v2 bridge tool core

The transport-neutral bridge tool facade currently defines:

- `thread.register_external`
- `thread.publish_checkpoint`
- `thread.publish_activity`
- `thread.refine_synopsis`
- `thread.get`
- `thread.list_pulse`

These tools are intended for ChatGPT/MCP, Codex event publishing, desktop clients, and future ASC-native runtimes.

### Caller identity

Transport adapters must resolve an authenticated caller to:
- ASC `Principal`;
- active `Membership`;
- one AccountDomain context.

The bridge core does **not** accept an email/provider username as resource authority.

Write tools require owner/admin/operator Membership. Synopsis refinement requires a human Principal. A bridge publisher cannot claim literal owner steering from another Principal.

Founder Relay provenance exists in the Thread domain, but arbitrary bridge callers are currently forbidden from publishing `founder_relay` steering until a bounded Relay authorization policy exists.

### External runtime honesty

A bridged ChatGPT/external Thread may publish checkpoints and activity while still advertising:
- no ASC runtime steer;
- no ASC runtime interrupt;
- no ASC runtime stop;
- no automatic Founder Relay send.

Revoking ASC execution authority is distinct from terminating an external consumer chat.

## Pulse semantics

Pulse is derived from normalized observable events/checkpoints, not an agent-written status field.

Examples:
- recent checkpoint/tool/progress activity -> Working;
- owner gate -> Needs You;
- explicit blocker -> Blocked;
- repeated identical failure signature without intervening meaningful progress -> Possible Loop;
- old active activity beyond threshold -> Stalled.

Heuristic loop/stall detection is advisory in v0 and does not itself kill a runtime.

## Authority boundary

- deterministic STOP / leases / WorkAuthorization remain in the ASC control registry;
- Thread/Pulse history lives in the separate tenant-scoped ThreadStore;
- ThreadStore/plugin failure cannot clear or bypass ControlState.

## Authenticated MCP transport

ASC now has a web-standard Streamable HTTP MCP resource-server surface at `/mcp`.

The transport:
- uses the stable MCP TypeScript SDK v2 server package;
- creates a fresh `McpServer` per request;
- requires OAuth bearer authentication before the MCP handler;
- advertises protected-resource metadata at the RFC 9728 well-known route, including the path-aware `/.well-known/oauth-protected-resource/mcp` route;
- requires the base `asc.mcp` scope for the endpoint;
- requires `asc.thread.read` for read tools;
- requires `asc.thread.write` for mutating bridge tools;
- publishes per-tool OAuth `securitySchemes` and scope challenges;
- validates Host/Origin ahead of MCP dispatch;
- delegates actual bridge authorization to the existing Principal/Membership-aware tool service.

ASC is an OAuth **resource server**, not the authorization server. Access tokens come from a separately configured OAuth/OIDC identity provider.

### Federated identity mapping

After signature/issuer/audience/time validation:
1. the token's stable `issuer + subject` resolves a durable `AuthenticationIdentityBinding`;
2. that binding resolves an ASC Principal;
3. the token-selected AccountDomain must have an active Membership for that Principal;
4. the requested MCP scope must be present;
5. only then does the request open that AccountDomain's control/thread services.

The token's AccountDomain never falls back to `ASC_DEFAULT_ACCOUNT_DOMAIN_ID`.

The default custom claim is `asc_account_domain_id`; deployments may configure the claim name without changing ASC domain semantics.

### OpenAI profile tool

Authenticated MCP exposes `get_profile`, marked with `_meta["openai/profile"]: true`.

The profile:
- is resolved from validated credentials;
- has a stable opaque ID derived from immutable ASC Principal + AccountDomain identity;
- may expose human-readable Principal/domain names as display metadata;
- never uses email as canonical identity.

This allows Personal and future Business ASC connections to be distinguishable as separate authenticated profiles.

Do not create a separate static-token authorization model merely for the bridge.

## Specialist boundaries

- Project-reality calls route to Development Intelligence.
- Reasoning method routes to Development OS.
- Exact provider/code/deployment execution routes to Conductor.
- ASC bridge tools publish orchestration context; they do not make chat text canonical Project truth.
