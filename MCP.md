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


## Guided first-time setup

ASC exposes an owner-authenticated readiness page at `/setup/mcp`.

The page is intentionally presence-only. It never renders database URLs, bearer tokens, authorization codes, client secrets, signing credentials, or other secret values.

### Minimum external inputs

A hosted Preview MCP proof currently needs three external infrastructure decisions:

1. **Durable PostgreSQL**
   - ASC first honors explicit `ASC_CONTROL_REGISTRY_DATABASE_URL`; otherwise it accepts standard `DATABASE_URL`.
   - This lets provider-native Vercel/Postgres integrations work without copying the same connection string into an ASC-specific variable.
   - The same ASC storage contract works with Neon, Supabase Postgres, ordinary hosted PostgreSQL, or future owner-operated PostgreSQL.

2. **Stable Preview MCP resource URL**
   - On Vercel, ASC automatically derives `https://<VERCEL_BRANCH_URL>/mcp` from the stable Git branch alias.
   - `ASC_MCP_RESOURCE_URL` remains an explicit override and the fallback for non-Vercel deployments.
   - ASC never derives OAuth resource identity from deployment-specific `VERCEL_URL`.

3. **External OAuth/OIDC authorization server**
   - Configure `ASC_OAUTH_ISSUER` and `ASC_OAUTH_JWKS_URL`.
   - Normal identity setup uses the owner-approved pairing flow in `/setup/mcp`; the owner does not copy a provider subject identifier.
   - `ASC_BOOTSTRAP_AUTH_ISSUER` + `ASC_BOOTSTRAP_AUTH_SUBJECT` remain an advanced/bootstrap compatibility path only.
   - Auth0 is a practical first documented provider because it offers MCP-oriented OAuth/CIMD support, but ASC remains provider-neutral.

### Safe built-in defaults

The following do not need environment variables for the personal proof unless the owner wants to override them:

- AccountDomain ID: `domain:personal`
- AccountDomain name: `Personal`
- Principal ID: `principal:owner`
- Principal name: `Owner`
- AccountDomain token claim: `asc_account_domain_id`
- scope claim: `scope`
- scopes:
  - `asc.mcp`
  - `asc.thread.read`
  - `asc.thread.write`

### First proof order

1. Confirm `/setup/mcp` shows the Vercel branch-derived MCP resource URL (or configure an explicit override for non-Vercel hosting).
2. Provision durable PostgreSQL.
3. Configure the external IdP for the exact MCP resource/audience.
4. Add the ASC scopes and AccountDomain claim.
5. In `/setup/mcp`, arm identity pairing.
6. Start the normal ChatGPT/MCP OAuth connection. ASC records the verified but unbound identity as a candidate and still denies access.
7. Approve the detected identity in ASC; this creates the durable issuer+subject binding.
8. Confirm `/setup/mcp` reports `ready_for_mcp_test`.
9. Reconnect/run MCP Inspector and then ChatGPT Developer Mode.

Do not promote the OAuth/MCP integration to Main merely because configuration exists; complete the Preview proof first.


### Owner-approved identity pairing

The normal personal onboarding path does not require the owner to discover or paste an OAuth subject.

Pairing lifecycle:
1. the authenticated ASC owner arms a short-lived pairing for the current Principal, AccountDomain, and configured issuer;
2. a cryptographically valid but unbound MCP token from that issuer may populate the pairing's candidate subject;
3. the MCP request remains denied;
4. ASC shows only that a verified identity was detected;
5. the represented owner approves or rejects the candidate;
6. approval creates the durable `AuthenticationIdentityBinding` and consumes the pairing;
7. the next authenticated request resolves normally.

Safety properties:
- no armed pairing means an unbound token writes no pairing state;
- one active pairing per issuer + AccountDomain prevents ambiguous multi-user capture in v0;
- expired/revoked/consumed pairings cannot be reused;
- another Principal cannot approve someone else's pairing;
- bearer tokens, authorization codes, and client secrets are never stored;
- the raw candidate subject is not rendered in the owner setup UI.

This pairing is Identity Directory lifecycle state, not Project truth, Thread history, or execution authority.
