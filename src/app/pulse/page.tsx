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
                          rel="noreferrer"
                        >
                          Open external thread
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
