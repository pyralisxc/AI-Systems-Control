import { redirect } from "next/navigation";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadPulseView } from "@/web/runtime/thread-pulse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tone(status: string): "positive" | "warning" | "critical" | "neutral" {
  if (status === "working" || status === "completed") return "positive";
  if (status === "waiting" || status === "needs_you") return "warning";
  if (
    status === "blocked" ||
    status === "possible_loop" ||
    status === "stalled"
  ) {
    return "critical";
  }
  return "neutral";
}

function relayTone(
  state: string
): "positive" | "warning" | "critical" | "neutral" {
  if (state === "auto_sent" || state === "owner_approved" || state === "edited") {
    return "positive";
  }
  if (state === "suggested") return "warning";
  if (state === "rejected") return "critical";
  return "neutral";
}

function relayStateLabel(state: string): string {
  if (state === "owner_approved") return "owner assisted";
  if (state === "auto_sent") return "auto sent";
  return state.replaceAll("_", " ");
}

function percentage(value: number | null): string {
  return value === null ? "—" : Math.round(value * 100) + "%";
}

function calibrationTone(
  readiness: string
): "positive" | "warning" | "critical" | "neutral" {
  if (readiness === "review_candidate") return "positive";
  if (readiness === "collecting") return "warning";
  if (readiness === "not_ready") return "critical";
  return "neutral";
}

function externalThreadActionLabel(provider: string | undefined): string {
  const normalized = provider?.trim().toLowerCase();
  if (normalized === "chatgpt" || normalized === "openai-chatgpt") {
    return "Open ChatGPT";
  }
  if (normalized === "codex" || normalized === "openai-codex") {
    return "Open Codex";
  }
  return "Open external thread";
}

export default async function PulsePage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login?returnTo=%2Fpulse");
  }

  const view = await loadPulseView();
  const counts = view.threads.reduce<Record<string, number>>(
    (result, item) => {
      result[item.pulse.status] = (result[item.pulse.status] ?? 0) + 1;
      return result;
    },
    {}
  );

  return (
    <main className="pulse-shell">
      <div className="pulse-page">
        <header className="connections-header">
          <div>
            <span className="eyebrow">ASC Pulse</span>
            <h1>Background supervision</h1>
            <p>
              Status is derived from durable checkpoints and observable activity,
              not from an agent merely claiming it is still working.
            </p>
          </div>
          <div className="connections-header__actions">
            <a className="connections-back" href="/">Back to project</a>
          </div>
        </header>

        {!view.configured ? (
          <div className="connections-notice">
            Durable ASC storage is not configured, so Pulse has no thread state
            to project.
          </div>
        ) : (
          <>
            <section className="pulse-summary" aria-label="Pulse summary">
              <article className="metric-card">
                <span>Threads</span>
                <strong>{view.threads.length}</strong>
                <small>{view.accountDomainId}</small>
              </article>
              <article className="metric-card">
                <span>Working</span>
                <strong>{counts.working ?? 0}</strong>
                <small>recent observable activity</small>
              </article>
              <article className="metric-card">
                <span>Needs you</span>
                <strong>{counts.needs_you ?? 0}</strong>
                <small>explicit owner gates</small>
              </article>
              <article className="metric-card">
                <span>Attention</span>
                <strong>
                  {(counts.blocked ?? 0) +
                    (counts.possible_loop ?? 0) +
                    (counts.stalled ?? 0)}
                </strong>
                <small>blocked · loop · stalled</small>
              </article>
            </section>

            <section className="pulse-list">
              {view.threads.length === 0 ? (
                <div className="empty-state">
                  No bridged or managed Threads have published into ASC yet.
                </div>
              ) : (
                view.threads.map((item) => (
                  <article className="pulse-card" key={item.thread.threadId}>
                    <div className="pulse-card__heading">
                      <div>
                        <span className="eyebrow">
                          {item.thread.mode} · {item.thread.externalReference?.provider ?? "asc"}
                        </span>
                        <h2>{item.thread.title}</h2>
                        <code>{item.thread.threadId}</code>
                      </div>
                      <span
                        className="status-pill"
                        data-tone={tone(item.pulse.status)}
                      >
                        <span className="status-dot" aria-hidden="true" />
                        {item.pulse.status.replaceAll("_", " ")}
                      </span>
                    </div>

                    <p className="pulse-reason">{item.pulse.reason}</p>

                    {item.synopsis ? (
                      <div className="pulse-synopsis">
                        <span>Latest synopsis</span>
                        <p>{item.synopsis}</p>
                      </div>
                    ) : null}

                    {item.blocker ? (
                      <p className="inline-problem">{item.blocker}</p>
                    ) : null}


                    {item.relay ? (
                      <section className="relay-card" aria-label="Founder Relay">
                        <div className="relay-card__heading">
                          <div>
                            <span className="eyebrow">Founder Relay</span>
                            <strong>
                              {item.relay.state === "suggested"
                                ? "Suggested continuation"
                                : item.relay.state === "auto_sent"
                                  ? "Delivered continuation"
                                  : item.relay.state === "rejected"
                                    ? "Rejected suggestion"
                                    : "Owner-assisted continuation"}
                            </strong>
                          </div>
                          <span
                            className="status-pill"
                            data-tone={relayTone(item.relay.state)}
                          >
                            <span className="status-dot" aria-hidden="true" />
                            {relayStateLabel(item.relay.state)}
                          </span>
                        </div>

                        <div className="relay-copy">
                          <span>Original proposal</span>
                          <p>{item.relay.proposedText}</p>
                        </div>

                        {item.relay.finalText &&
                        item.relay.finalText !== item.relay.proposedText ? (
                          <div className="relay-copy relay-copy--final">
                            <span>Owner-assisted final text</span>
                            <p>{item.relay.finalText}</p>
                          </div>
                        ) : null}

                        <div className="relay-authority">
                          <div>
                            <span>Proposal authority</span>
                            <strong>
                              {item.relay.proposalAuthority.decision.replaceAll("_", " ")}
                            </strong>
                            <p>{item.relay.proposalAuthority.reason}</p>
                          </div>
                          <div>
                            <span>Requested scope</span>
                            <strong>
                              {item.relay.workClass} · {item.relay.requestedEffect}
                            </strong>
                            <p>{item.relay.requestedRepositoryBoundary}</p>
                          </div>
                          <div>
                            <span>Provenance</span>
                            <strong>{item.relay.representedPrincipalId}</strong>
                            <p>generated by {item.relay.generatedByPrincipalId}</p>
                          </div>
                        </div>

                        <div className="relay-basis">
                          {item.relay.proposalAuthority.basis.envelopeId ? (
                            <code>
                              envelope {item.relay.proposalAuthority.basis.envelopeId}
                            </code>
                          ) : null}
                          {item.relay.proposalAuthority.basis.grantId ? (
                            <code>
                              grant {item.relay.proposalAuthority.basis.grantId}
                            </code>
                          ) : null}
                          {item.relay.proposalAuthority.basis.authorizationId ? (
                            <code>
                              authorization {item.relay.proposalAuthority.basis.authorizationId}
                            </code>
                          ) : null}
                        </div>


                        {item.calibration ? (
                          <div className="relay-calibration">
                            <div className="relay-calibration__heading">
                              <div>
                                <span className="eyebrow">
                                  Interaction calibration
                                </span>
                                <strong>
                                  {item.calibration.respondedCount}/
                                  {item.calibration.policy.minimumResponses} explicit
                                  owner responses
                                </strong>
                              </div>
                              <span
                                className="status-pill"
                                data-tone={calibrationTone(
                                  item.calibration.readiness
                                )}
                              >
                                <span className="status-dot" aria-hidden="true" />
                                {item.calibration.readiness.replaceAll("_", " ")}
                              </span>
                            </div>

                            <div className="relay-calibration__metrics">
                              <div>
                                <span>Accepted</span>
                                <strong>
                                  {percentage(item.calibration.acceptanceRate)}
                                </strong>
                              </div>
                              <div>
                                <span>Edited</span>
                                <strong>
                                  {percentage(item.calibration.editRate)}
                                </strong>
                              </div>
                              <div>
                                <span>Rejected</span>
                                <strong>
                                  {percentage(item.calibration.rejectionRate)}
                                </strong>
                              </div>
                              <div>
                                <span>Edit magnitude</span>
                                <strong>
                                  {percentage(
                                    item.calibration.meanNormalizedEditRatio
                                  )}
                                </strong>
                              </div>
                            </div>

                            <p className="relay-note">
                              {item.calibration.readinessReasons[0]}
                              {item.calibration.readiness === "review_candidate"
                                ? " This is evidence for an owner autonomy review; ASC has not changed any grant."
                                : ""}
                            </p>
                            <code className="relay-calibration__ref">
                              {item.calibration.evidenceReference}
                            </code>

                            {item.currentAutonomyGrant ? (
                              <div className="relay-autonomy-state">
                                <span>Current autonomy</span>
                                <strong>
                                  Level {item.currentAutonomyGrant.level} ·{" "}
                                  {item.currentAutonomyGrant.repositoryCeiling.replaceAll(
                                    "_",
                                    " "
                                  )}
                                </strong>
                                <small>
                                  {item.currentAutonomyGrant.state.replaceAll("_", " ")}
                                </small>
                              </div>
                            ) : null}

                            {item.hasReadOnlyThreadEnvelope ? (
                              <div className="relay-thread-envelope">
                                <span>Thread continuation</span>
                                <strong>
                                  Continue Level 2 · Thread bounded · read-only · no tools
                                </strong>
                                <small>
                                  A deterministic WorkEnvelope now covers this exact
                                  Thread/work class. Owner gates, grant review, and STOP
                                  still return control to you.
                                </small>
                              </div>
                            ) : item.canEnableThreadContinue ? (
                              <form
                                className="relay-autonomy-review"
                                method="post"
                                action="/api/pulse/enable-thread-continue"
                              >
                                <input
                                  type="hidden"
                                  name="threadId"
                                  value={item.thread.threadId}
                                />
                                <button
                                  className="relay-action relay-action--approve"
                                  type="submit"
                                >
                                  Enable read-only Continue for this Thread
                                </button>
                                <small>
                                  Exact Thread/work class only · no capabilities · no
                                  mutation · no work-branch/Preview/Main authority.
                                </small>
                              </form>
                            ) : null}

                            {item.canGrantContinue && item.relay ? (
                              <form
                                className="relay-autonomy-review"
                                method="post"
                                action="/api/pulse/grant-continue"
                              >
                                <input
                                  type="hidden"
                                  name="threadId"
                                  value={item.thread.threadId}
                                />
                                <input
                                  type="hidden"
                                  name="relayId"
                                  value={item.relay.relayId}
                                />
                                <button
                                  className="relay-action relay-action--approve"
                                  type="submit"
                                >
                                  Grant Continue · read-only
                                </button>
                                <small>
                                  Explicit Level 2 grant only. A matching WorkEnvelope
                                  is still required before ASC can continue automatically.
                                </small>
                              </form>
                            ) : item.calibration.readiness === "review_candidate" &&
                              item.currentAutonomyGrant?.state === "active" &&
                              item.currentAutonomyGrant.level >= 2 ? (
                              <p className="relay-note">
                                This work class already has Continue-or-higher autonomy.
                                Calibration has not changed the grant automatically.
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {item.relay.state === "suggested" && item.canReviewRelay ? (
                          <div className="relay-review">
                            <form
                              className="relay-review__quick"
                              method="post"
                              action="/api/pulse/relay-feedback"
                            >
                              <input
                                type="hidden"
                                name="threadId"
                                value={item.thread.threadId}
                              />
                              <input
                                type="hidden"
                                name="relayId"
                                value={item.relay.relayId}
                              />
                              <button
                                className="relay-action relay-action--approve"
                                type="submit"
                                name="action"
                                value="approve"
                              >
                                Approve
                              </button>
                              <button
                                className="relay-action relay-action--reject"
                                type="submit"
                                name="action"
                                value="reject"
                              >
                                Reject
                              </button>
                            </form>

                            <form
                              className="relay-review__edit"
                              method="post"
                              action="/api/pulse/relay-feedback"
                            >
                              <input
                                type="hidden"
                                name="threadId"
                                value={item.thread.threadId}
                              />
                              <input
                                type="hidden"
                                name="relayId"
                                value={item.relay.relayId}
                              />
                              <input type="hidden" name="action" value="edit" />
                              <label htmlFor={"relay-edit-" + item.relay.relayId}>
                                Edit before accepting
                              </label>
                              <textarea
                                id={"relay-edit-" + item.relay.relayId}
                                name="editedText"
                                defaultValue={item.relay.proposedText}
                                rows={3}
                                required
                              />
                              <button className="relay-action" type="submit">
                                Save owner-assisted edit
                              </button>
                            </form>
                          </div>
                        ) : item.relay.state === "suggested" ? (
                          <p className="relay-note">
                            This Relay is waiting for the represented Principal.
                            The current web session cannot approve it on their behalf.
                          </p>
                        ) : item.relay.state === "owner_approved" ||
                          item.relay.state === "edited" ? (
                          <p className="relay-note">
                            Owner-assisted draft recorded. This does not mean the
                            external conversation was changed or the message was sent.
                          </p>
                        ) : item.relay.state === "auto_sent" ? (
                          <p className="relay-note">
                            Delivered through a send-capable transport after a fresh
                            authority check.
                          </p>
                        ) : (
                          <p className="relay-note">
                            Rejected suggestion retained as calibration evidence.
                          </p>
                        )}
                      </section>
                    ) : null}

                    <div className="pulse-meta">
                      <span>
                        {item.thread.runtimeCapabilities.canSteer
                          ? "ASC can steer runtime"
                          : "runtime steering unavailable"}
                      </span>
                      <span>
                        {item.thread.runtimeCapabilities.canStopRuntime
                          ? "runtime stop available"
                          : "ASC cannot stop external runtime"}
                      </span>
                      {item.pulse.repeatedFailureCount ? (
                        <span>
                          repeated failure ×{item.pulse.repeatedFailureCount}
                        </span>
                      ) : null}
                    </div>

                    <div className="pulse-card__actions">
                      {item.thread.externalReference?.navigationUrl ? (
                        <a
                          className="connections-back"
                          href={item.thread.externalReference.navigationUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {externalThreadActionLabel(
                            item.thread.externalReference.provider
                          )}
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
