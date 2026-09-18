# Action, Policy, and Security Contract

## Governed mutation rule

Any operation that can materially change an external system must enter the Action lifecycle before execution.

Examples:
- create/update/delete GitHub issues or PRs;
- change repository settings;
- deploy;
- mutate infrastructure;
- change secrets or permissions;
- write to product data;
- publish or release.

Read-only observation does not require an Action, but it still requires provenance.

## Action phases

1. **Propose** — normalize target, capability, parameters, rationale, and expected effect.
2. **Resolve binding** — determine the concrete host/provider/adapter.
3. **Policy check** — evaluate risk, scope, permissions, environment, and approval requirements.
4. **Authorize** — collect explicit authorization where policy requires it.
5. **Execute** — perform the effect through the resolved binding.
6. **Receipt** — record the executor/provider response.
7. **Reconcile** — obtain fresh observed state.
8. **Verify/close** — mark verified only when observed reality supports the requested effect.

## Security principles

- least privilege per capability binding;
- no secret material in Action logs or receipts;
- permission state is explicit and can be unknown;
- capability discovery must not imply capability authorization;
- deny-by-default for mutations with unresolved identity/scope;
- immutable audit history for Action decisions and receipts;
- idempotency/correlation keys for retryable effects;
- replay protection for approvals where practical.

## Permission escalation object

When execution is blocked by permission, create an escalation requirement containing:
- blocked capability;
- provider/host;
- missing permission/scope when known;
- affected Action;
- safe next step;
- whether owner intervention is required.

Do not silently switch to a broader credential or different host.

## Failure semantics

An Action can end as:
- verified;
- failed before effect;
- reported-but-unverified;
- indeterminate;
- cancelled.

A timeout after provider submission must not be labeled failed if the external effect may have happened. It becomes indeterminate until reconciliation resolves it.
