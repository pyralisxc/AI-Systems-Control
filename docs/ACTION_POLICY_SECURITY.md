# Authorization, Execution, and Security Contract — ASC v2

## Authority rule

Work status, model confidence, tool availability, and provider connectivity do not grant execution authority.

Externally meaningful work requires:
1. a valid owner WorkAuthorization where policy requires owner consent;
2. an active WorkerSession when performed by an agent;
3. a valid ExecutionLease for the requested capability;
4. matching ControlState generation;
5. successful Conductor/provider policy checks.

## Owner Verification

Owner Verification is the durable consent boundary.

It must bind to the exact reviewed work/scope and remain:
- inspectable;
- revocable;
- supersedable;
- invalidatable when material context changes.

Agents may recommend work or enrich issues without creating owner authority.

## Capability rule

Workers receive scoped capability references/leases, not durable raw credentials.

Capability availability is not capability authorization.

Missing permission must not cause silent fallback to a broader identity, different AccountDomain, or alternate credential.

## Stop and fencing

Control scopes may include:
- system;
- AccountDomain;
- Project;
- WorkerSession.

An owner stop:
- increments/revokes the applicable control generation;
- prevents new lease issuance/dispatch within scope;
- causes stale leases to fail on subsequent execution;
- cannot be auto-cleared by a worker/supervisor.

Best-effort runtime cancellation may accompany stop, but authorization revocation is the security boundary.

## Execution boundary

Conductor owns exact provider/code/deployment execution mechanics, idempotency, correlation, receipts, and provider-specific failures.

ASC references those executions; it does not duplicate the provider executor.

## Observation / verification

A provider success response is not independently verified project reality.

Where verification matters:
- use provider read-back;
- tests;
- DI evidence/parity;
- runtime/browser evidence;
- or an explicit owner result review.

The required proof should be proportional to the change/risk.

## Secrets and identity

- secrets remain opaque in logs/owner surfaces;
- workers receive only minimum scoped authority;
- personal/business AccountDomains do not mix implicitly;
- revoked/expired connection authority invalidates dependent leases;
- cross-project/cross-domain mutations require explicit scope.

## Failure semantics

ASC should distinguish:
- blocked before effect;
- stopped/revoked;
- expired;
- provider execution failed;
- indeterminate external effect;
- execution reported;
- independently verified result.

Do not collapse these into one success/failure badge.
