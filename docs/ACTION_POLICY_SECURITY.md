# Authorization, Execution, and Security Contract — ASC v2

## Authority rule

Authentication, work status, model confidence, tool availability, and provider connectivity do not grant execution authority.

Externally meaningful work requires:
1. a resolved Principal and valid Membership in the applicable AccountDomain;
2. a valid WorkAuthorization where policy requires human approval;
3. an active WorkerSession/Run for agent work;
4. a valid ExecutionLease for the requested capability;
5. matching ControlState generation;
6. successful Conductor/provider policy checks.

## Principal and Membership

A Principal is the actor identity. Membership establishes that Principal's relationship to an AccountDomain.

Personal mode is one human Principal with an owner Membership. Multi-user deployments may have multiple human/service Principals.

Role labels are not themselves the final authorization decision. Resource/effect/scope policy remains authoritative and deny-by-default.

Cross-domain access is never inferred merely because one Principal belongs to multiple AccountDomains.

## OAuth / MCP resource-server boundary

ASC's private/write MCP surface is an OAuth resource server.

For every MCP request:
1. validate token signature against configured JWKS;
2. validate issuer, resource/audience, expiry/time claims;
3. require a stable subject;
4. resolve issuer+subject to an active ASC AuthenticationIdentityBinding/Principal;
5. require active Membership in the token-selected AccountDomain;
6. enforce endpoint and per-tool scopes;
7. execute the bridge tool under that exact Principal + AccountDomain context.

A cryptographically valid token is insufficient when its external identity is unbound or its Membership is inactive.

The raw bearer token and authorization code must not be written to Identity Directory, ControlRegistryStore, ThreadStore, Relay history, or ordinary audit surfaces.

ASC does not implement a second authorization model inside MCP tool handlers. Transport scope checks and the domain bridge policy both apply.

The current deployment uses a separate OAuth/OIDC authorization server. ASC should not become a general-purpose identity provider merely to support ChatGPT.

## Owner Verification / approvals

"Owner Verified" remains valid personal-mode UX, but the durable consent boundary is an approval/policy result bound to exact reviewed work and Principal provenance.

Approvals must remain inspectable, revocable, supersedable, and invalidatable when material context changes.

Agents may recommend work or enrich issues without creating approval authority.

## Bounded continuation

Autonomous continuation is evaluated deterministically from durable ASC state.

A continuation may proceed automatically only when all applicable boundaries agree:
- an active WorkEnvelope covers the exact Project/work class/effect/repository boundary;
- the WorkEnvelope continuation policy permits non-interactive continuation;
- a current AutonomyGrant covers that work class at a sufficient level;
- the requested repository boundary is within both envelope and grant ceilings;
- mutable/integration work has an active matching WorkAuthorization;
- no explicit owner gate has been reached;
- current ControlState is running.

Level 2 (Continue) may support read-only continuation. Mutation/integration requires Level 3 (Integrate) or higher.

Even Level 5 cannot:
- expand Preview authority to Main;
- continue after an owner gate;
- use a stale/needs-revalidation WorkAuthorization;
- override paused/owner-stopped ControlState.

Expired or needs-review grants return to the owner rather than silently falling back to an older grant.

## Founder Relay

Founder Relay is an interaction/continuation mechanism, not a source of owner authority.

A service Principal may generate a suggestion representing an active human owner/admin Principal, but:
- the immutable proposal remains distinguishable from literal owner speech;
- another human Principal cannot approve/edit a proposal represented as someone else;
- approve/edit/reject feedback is stored with the actual feedback Principal;
- approved or edited suggestions are owner-assisted records;
- only a delivery accepted through a real send-capable transport after a fresh continuation-authority evaluation may become `auto_sent`.

Proposal-time `allow` is never sufficient for auto-send. Delivery must re-evaluate current WorkEnvelope, AutonomyGrant, WorkAuthorization where applicable, and ControlState.

If STOP, owner gate, grant review, authorization revalidation, expiry, or repository/effect ceiling changes after proposal, auto-send fails closed.

If authority permits a Relay but the external Thread cannot be programmatically steered, ASC surfaces owner attention/manual delivery instead of pretending the external chat was changed.

Relay delivery adapters must be idempotent by Relay ID so transport retries do not intentionally duplicate owner-channel messages.

Founder Relay history belongs to tenant-scoped ThreadStore interaction history, not Project truth or the deterministic authority registry.

Derived Relay calibration is a read projection over explicit Relay outcomes. It is not executable authority.

- pending suggestions do not count as settled calibration evidence;
- owner-approved/edited/rejected records and actual auto-send outcomes may contribute;
- calibration is scoped by represented Principal + AccountDomain + Project + work class;
- review-readiness thresholds are policy inputs;
- satisfying a threshold may surface owner attention but cannot mutate AutonomyGrant;
- changing calibration policy does not rewrite underlying Relay history.

An owner-facing earned-autonomy review may create a bounded grant only after server-side evidence recomputation. The initial supported action is Level 2 / read-only:
- represented Principal must equal the reviewing authenticated Principal;
- readiness must still be `review_candidate`;
- evidence reference/fingerprint are recomputed from ThreadStore, not trusted from browser input;
- an active Level 2+ grant is not duplicated or downgraded;
- no WorkEnvelope or WorkAuthorization is created;
- no mutation, work-branch, Preview, or Main authority is granted.

## Capability rule

Workers receive scoped capability references/leases, not durable raw credentials.

Capability availability is not capability authorization.

Missing permission must not cause silent fallback to a broader identity, different AccountDomain, or alternate credential.

## Tenant isolation

Every normal control-store instance is bound to one AccountDomain.

- normal tenant requests must not load unrelated tenants;
- Projects and Connections persisted in a tenant registry must match that AccountDomain;
- cross-tenant writes fail closed;
- service/global operations require explicit system/service identity rather than fabricated tenant membership.

Identity directory data (Principals, AccountDomains, Memberships) is stored separately from tenant control state.

## Stop and fencing

Control scopes may include:
- system;
- AccountDomain;
- Project;
- WorkerSession/Run.

An owner-level or policy-authorized stop:
- increments/revokes applicable control generation;
- prevents new lease issuance/dispatch within scope;
- causes stale leases to fail on subsequent execution;
- cannot be auto-cleared by a lower-authority worker/supervisor.

Best-effort runtime cancellation may accompany stop, but authorization revocation is the security boundary.

## Execution boundary

Conductor owns exact provider/code/deployment execution mechanics, idempotency, correlation, receipts, and provider-specific failures.

ASC references those executions; it does not duplicate the provider executor.

## Observation / verification

A provider success response is not independently verified Project reality.

Where verification matters, use provider read-back, tests, DI evidence/parity, runtime/browser evidence, or explicit human result review.

## Secrets and identity

- secrets remain opaque in logs/owner surfaces;
- Connections store `authorizedByPrincipalId`, not a raw credential or singular-owner ownership model;
- workers receive only minimum scoped authority;
- personal/business AccountDomains do not mix implicitly;
- revoked/expired Connection authority invalidates dependent leases/delegations;
- cross-project/cross-domain mutations require explicit scope;
- service actors are distinguishable from the human Principal who approved/delegated work.

## Personal bootstrap

The current password-based deployment may auto-bootstrap one human Principal, one personal AccountDomain, and one owner Membership.

This compatibility path is controlled by `ASC_PERSONAL_BOOTSTRAP_ENABLED` and can be disabled for federated/enterprise deployments. Disabling bootstrap must never auto-create a fallback tenant or Principal.

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
