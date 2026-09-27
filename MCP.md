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

## Transport

The current implementation is transport-neutral. An MCP/ChatGPT transport must map authenticated session identity into `BridgeToolCaller` and delegate tool calls to `AscBridgeToolService`.

Do not create a separate static-token authorization model merely for the bridge.

## Specialist boundaries

- Project-reality calls route to Development Intelligence.
- Reasoning method routes to Development OS.
- Exact provider/code/deployment execution routes to Conductor.
- ASC bridge tools publish orchestration context; they do not make chat text canonical Project truth.
