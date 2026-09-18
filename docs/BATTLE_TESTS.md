# Battle Tests — 56 Scenarios

These are architecture-level scenarios. Slice implementations should automate the relevant subset and preserve the invariant when new providers are added.

## A. Project identity and source truth (A01–A08)
- **A01** Same GitHub repo opened twice resolves to one Project identity.
- **A02** Repo rename preserves durable Project identity through canonical reference reconciliation.
- **A03** Deleted/inaccessible repo becomes unavailable, not deleted Project truth.
- **A04** Conflicting repository references are surfaced, not silently merged.
- **A05** Stale observation is labeled stale.
- **A06** Provider response without evidence/provenance is rejected from observed truth.
- **A07** Partial provider outage produces partial/unknown observations.
- **A08** A Workspace cannot overwrite canonical Project identity.

## B. Workspace and capability binding (B01–B08)
- **B01** Two Workspaces over one Project can select different hosts without duplicating the Project.
- **B02** Capability known globally but unsupported on selected host is unavailable with reason.
- **B03** Capability supported but missing permission is permission-blocked.
- **B04** Permission refresh causes binding re-resolution.
- **B05** Adapter outage does not remove the Capability definition.
- **B06** Workspace-local filters do not alter observed provider state.
- **B07** Binding selection is deterministic for equal inputs/policy.
- **B08** Ambiguous bindings require explicit resolution rather than arbitrary choice.

## C. Desired vs observed state (C01–C08)
- **C01** Equal comparable values resolve aligned.
- **C02** Unequal comparable values resolve divergent.
- **C03** Missing observation resolves unknown.
- **C04** Stale observation resolves stale rather than aligned.
- **C05** Different schemas resolve incomparable.
- **C06** Desired state records its authority/source.
- **C07** Multiple desired-state authorities with conflict are surfaced.
- **C08** Fresh reconciliation can move drift from divergent to aligned.

## D. Action and policy (D01–D08)
- **D01** Mutating capability cannot execute without an Action.
- **D02** Read capability does not create a mutation Action.
- **D03** Denied policy decision prevents execution.
- **D04** Required approval blocks until matching authorization exists.
- **D05** Approval for one target cannot authorize another target.
- **D06** Expired/revoked authorization cannot execute.
- **D07** Parameter changes after approval invalidate authorization when material.
- **D08** Policy explanation is persisted with the Action.

## E. Effect receipt and reconciliation (E01–E08)
- **E01** Provider success creates a Receipt but not verified state.
- **E02** Fresh observation confirming effect marks verified.
- **E03** Provider timeout after submission becomes indeterminate.
- **E04** Reconciliation can discover effect succeeded despite timeout.
- **E05** Reconciliation can discover reported success did not persist.
- **E06** Retry uses idempotency/correlation semantics when supported.
- **E07** Receipt preserves provider identifiers without storing secrets.
- **E08** Verification evidence is traceable from closed Action.

## F. Permission escalation and security (F01–F08)
- **F01** Missing scope produces an escalation requirement.
- **F02** System does not silently switch to a broader credential.
- **F03** Secret-bearing provider payload is redacted from audit surfaces.
- **F04** Unknown identity blocks high-risk mutation.
- **F05** Cross-project authorization is rejected.
- **F06** High-risk Action cannot bypass founder verification policy.
- **F07** Permission increase triggers binding/policy re-evaluation.
- **F08** Revoked permission during execution yields explicit failure/indeterminate state.

## G. System boundaries and resilience (G01–G08)
- **G01** Development Intelligence unavailable -> reality fields degrade to unknown, not locally reinvented analysis.
- **G02** Development OS unavailable -> reasoning capability unavailable, control-plane state remains intact.
- **G03** Conductor unavailable -> orchestration capability unavailable, direct mutation path is not substituted.
- **G04** Web Foundation unavailable -> control-plane domain still functions.
- **G05** Provider-specific fields remain behind adapter/projection boundaries.
- **G06** A new provider can bind an existing Capability without changing Action semantics.
- **G07** Agent cannot add a direct mutation shortcut without failing architecture tests/review.
- **G08** Historical Actions/Receipts remain interpretable after adapter/version upgrades.

Total: **56 scenarios**.
