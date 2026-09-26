# Battle Tests — ASC v2

These scenarios test the current supervisory-control architecture. The legacy Slice A test suite remains useful implementation evidence but does not define the v2 product center.

## A. Authority separation

- **A01** Ready GitHub issue without Owner Verification cannot receive an execution lease.
- **A02** Owner Verified issue remains a GitHub issue; ASC does not create a duplicate canonical task.
- **A03** Agent recommendation cannot set Owner Verified.
- **A04** Green CI does not imply owner authorization.
- **A05** Merge state does not imply permanent product-direction acceptance.
- **A06** Result verification is distinguishable from intent/work verification.

## B. Authorization integrity

- **B01** Authorization records exact owner, Project, work reference, scope/fingerprint, and time.
- **B02** Material work-scope change invalidates or requires revalidation.
- **B03** Authorization for one Project cannot authorize another.
- **B04** Revoked authorization cannot issue a new lease.
- **B05** Superseded authorization remains historically inspectable but non-executable.
- **B06** Work-status changes do not silently mutate authorization state.

## C. Worker / lease control

- **C01** WorkerSession requires a valid authorization for executable work.
- **C02** Lease has bounded capabilities and expiry.
- **C03** Expired lease cannot execute.
- **C04** Revoked lease cannot execute.
- **C05** Worker stop prevents subsequent mutations even if the process keeps running.
- **C06** Parent worker cannot grant a child more authority than the parent holds.

## D. Stop / fencing

- **D01** Project stop blocks all project worker mutations.
- **D02** Project stop blocks new dispatch/lease issuance.
- **D03** STOP ALL blocks all ASC-mediated mutable execution.
- **D04** Lower-authority agent cannot clear an owner stop.
- **D05** Old control-generation token fails after stop/resume generation changes.
- **D06** Already-completed external effects are reported/reconciled rather than pretended undone.

## E. Account / connection isolation

- **E01** One Owner can hold distinct personal/business AccountDomains.
- **E02** Project in Business A cannot see Personal connections by default.
- **E03** Two Google/GitHub/provider identities remain separately addressable.
- **E04** Missing permission does not silently switch to another connection.
- **E05** Worker never receives raw long-lived provider credentials through normal control APIs.
- **E06** Explicit cross-domain grant is narrow, attributable, and revocable.

## F. System boundaries

- **F01** Project meaning stays in Project repository/history, not copied into ASC canonical state.
- **F02** DI unavailable does not cause ASC to invent project understanding.
- **F03** Conductor unavailable does not cause ASC to add direct provider-mutation shortcuts.
- **F04** GitHub/provider-native state is referenced, not duplicated as a second authority.
- **F05** DevOS can remain usable without ASC-specific tools.
- **F06** ASC deterministic control state is readable with no LLM running.
- **F07** A feature that needs another system's semantic state stores only the minimum reference/control metadata in ASC; duplicating the owned semantics fails architecture review.

## G. Conversational / agent resilience

- **G01** New worker can cold-start from Project/DI/work authorization without complete prior chat transcript.
- **G02** Transcript wording cannot override revoked authorization.
- **G03** Messy natural-language owner input may be interpreted, but ambiguous consequential scope returns to owner attention.
- **G04** Replacing/saturating a worker does not lose durable work/control state.
- **G05** Unsupported consumer ChatGPT-chat access degrades cleanly rather than becoming a hidden dependency.
- **G06** Lightweight control/informer model cannot bypass deterministic authority checks.

## H. Evidence and change

- **H01** DI parity/impact conclusions retain coverage/uncertainty rather than becoming a binary safety oracle.
- **H02** Provider success and DI verification remain distinct observations.
- **H03** Authorization may reference Project/DI revision context without making ASC the owner of product meaning.
- **H04** Historical project documentation may evolve without rewriting ASC history.
- **H05** Candidate audit findings can exist without becoming executable work.
- **H06** Owner attention is exception-driven; successful routine events do not flood the attention queue.

Total: **49 v2 scenarios**.
