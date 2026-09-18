# Domain Model

## Primary entities

### Project
A durable identity for a product/system.

Required fields:
- `project_id`
- `name`
- `references[]` — provider/reality references such as GitHub repository identity
- `created_at`
- `status`

A Project is not a checkout, browser tab, chat, or temporary execution.

### Workspace
An operator-scoped context over one Project.

A Workspace may hold:
- selected environment/host;
- active objective;
- desired-state overlay;
- visible panels;
- capability bindings;
- session-local filters.

Workspace state must never silently overwrite Project identity or provider truth.

### Capability
A typed declaration of something that can be done.

Minimum contract:
- `capability_id`
- `name`
- `input_schema`
- `output_schema`
- `effect_class`: read | propose | mutate
- `risk_class`
- `owner_system`

A Capability is abstract until it is bound.

### CapabilityBinding
Resolves a Capability to the host/provider/adapter that can realize it in the current Project/Workspace.

Minimum contract:
- `binding_id`
- `capability_id`
- `project_id`
- optional `workspace_id`
- `host`
- `provider`
- `adapter`
- `permission_state`
- `availability_state`
- `reason` when unavailable

Bindings are host-aware. "The system supports GitHub" is insufficient; availability is evaluated for the current project, host, identity, and permission state.

## State model

### DesiredState
Operator/control-plane intent expressed declaratively where possible.

Each desired-state claim must have:
- scope;
- key/path;
- value;
- authority/source;
- effective time;
- optional policy owner.

### Observation
A normalized statement about external reality.

Each Observation must include:
- subject;
- property;
- value or explicit unknown;
- observed_at;
- source/evidence references;
- producing system;
- confidence/quality when applicable.

### Drift
A computed relation between DesiredState and sufficiently comparable Observations.

Drift is not allowed to invent certainty. Valid outcomes include:
- aligned;
- divergent;
- unknown;
- incomparable;
- stale.

## Action model

### Action
A durable proposal for an externally meaningful mutation.

Lifecycle:
`draft -> proposed -> policy_checked -> awaiting_authorization? -> authorized -> executing -> effect_reported -> reconciling -> verified | failed | cancelled | indeterminate`

Minimum fields:
- `action_id`
- target Project/Workspace
- capability + selected binding
- normalized intent
- requested effect
- proposer
- policy decision
- authorization evidence when required
- execution correlation
- timestamps

### PolicyDecision
Records whether an Action is allowed, denied, or requires escalation.

It must preserve:
- rule/policy identifiers;
- inputs considered;
- decision;
- explanation;
- required approver or permission change.

### EffectReceipt
Records what the executor/provider reported after an attempted Action.

It is not equivalent to verified reality.

Minimum fields:
- action_id;
- executor/provider;
- request fingerprint/correlation id;
- reported result;
- provider identifiers/URLs when available;
- reported_at;
- reconciliation status.

### Reconciliation
A fresh observation pass that determines whether the requested external effect is actually present.

## Key invariants
1. External reality has provenance.
2. Unknown is a valid state.
3. Tool availability is not authorization.
4. Reported success is not verified success.
5. Workspace convenience cannot create a second provider truth.
6. Specialist-system ownership remains explicit at every boundary.
