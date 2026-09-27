import { redirect } from "next/navigation";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadConnectionsControlView } from "@/web/runtime/control-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tone(status: string): "positive" | "warning" | "critical" | "neutral" {
  if (status === "active") return "positive";
  if (status === "reconnect_required" || status === "unavailable") return "warning";
  if (status === "revoked") return "critical";
  return "neutral";
}

export default async function ConnectionsPage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login?returnTo=%2Fconnections");
  }

  const view = await loadConnectionsControlView();

  if (!view.configured) {
    return (
      <main className="connections-shell">
        <div className="connections-page">
          <header className="connections-header">
            <div>
              <span className="eyebrow">ASC Connections</span>
              <h1>Connection broker</h1>
              <p>
                Project identity, provider accounts, and delegated capabilities stay
                separate from provider credentials.
              </p>
            </div>
            <a className="connections-back" href="/">Back to project</a>
          </header>
          <div className="connections-notice">
            Durable control-registry storage is not configured on this host.
            Set <code>ASC_CONTROL_REGISTRY_DATABASE_URL</code> to a PostgreSQL database
            for hosted/serverless mode, or <code>ASC_CONTROL_REGISTRY_PATH</code> to a
            persistent server volume for local/self-hosted mode. ASC will not write
            authority state to ephemeral storage.
          </div>
        </div>
      </main>
    );
  }

  const active = view.connections.filter((connection) => connection.status === "active").length;
  const domains = new Set(view.connections.map((connection) => connection.accountDomainId));
  const projectMap = new Map(view.projects.map((project) => [project.projectId, project]));

  return (
    <main className="connections-shell">
      <div className="connections-page">
        <header className="connections-header">
          <div>
            <span className="eyebrow">ASC Connections</span>
            <h1>Connection broker</h1>
            <p>
              One owner-facing view over provider identities and the Projects allowed
              to use them. Credentials remain behind adapters; ordinary ASC objects
              expose only connection identities and capabilities.
            </p>
          </div>
          <div className="connections-header__actions">
            <a className="connections-back" href="/">Back to project</a>
          </div>
        </header>

        <section className="connections-summary" aria-label="Connection summary">
          <article className="metric-card">
            <span>Connections</span>
            <strong>{view.connections.length}</strong>
            <small>{active} active</small>
          </article>
          <article className="metric-card">
            <span>Account domains</span>
            <strong>{domains.size}</strong>
            <small>personal / business isolation</small>
          </article>
          <article className="metric-card">
            <span>Project bindings</span>
            <strong>{view.bindings.filter((binding) => binding.status === "active").length}</strong>
            <small>explicit capability routing</small>
          </article>
        </section>

        <div className="connections-notice">
          Provider-native connect/reconnect flows are intentionally not simulated yet.
          This surface currently inspects real ASC registry state and can revoke ASC
          authority. OAuth/app-installation adapters will attach here without changing
          the core Connection model.
        </div>

        <section className="connections-grid">
          {view.connections.length === 0 ? (
            <div className="empty-state">No provider Connections are registered yet.</div>
          ) : (
            view.connections.map((connection) => {
              const bindings = view.bindings.filter(
                (binding) => binding.connectionId === connection.connectionId
              );
              return (
                <article className="connection-card" key={connection.connectionId}>
                  <div>
                    <span className="eyebrow">{connection.provider}</span>
                    <h2>{connection.label ?? connection.providerDisplayName ?? connection.providerAccountId}</h2>
                    <code>{connection.connectionId}</code>
                    <div style={{ marginTop: 10 }}>
                      <span className="status-pill" data-tone={tone(connection.status)}>
                        <span className="status-dot" aria-hidden="true" />
                        {connection.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  </div>

                  <div className="connection-card__meta">
                    <div>
                      <strong>Account domain</strong> · {connection.accountDomainId}
                    </div>
                    <div>
                      <strong>Provider identity</strong> · {connection.providerAccountId}
                      {connection.environment ? " · " + connection.environment : ""}
                    </div>
                    <div>
                      <strong>Generation</strong> · {connection.generation}
                    </div>

                    <div className="connection-capabilities">
                      {connection.capabilities.length > 0 ? (
                        connection.capabilities.map((capability) => (
                          <span className="connection-chip" key={capability}>{capability}</span>
                        ))
                      ) : (
                        <span className="connection-chip">no discovered capabilities</span>
                      )}
                    </div>

                    <div className="connection-bindings">
                      {bindings.length > 0 ? (
                        bindings.map((binding) => {
                          const boundProject = projectMap.get(binding.projectId);
                          return (
                            <div className="connection-binding" key={binding.bindingId}>
                              <strong>{boundProject?.name ?? binding.projectId}</strong>
                              <span>
                                {binding.environment ?? "all environments"} · {binding.capabilityScope.kind}:{binding.capabilityScope.value}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <span className="connection-chip">unbound</span>
                      )}
                    </div>
                  </div>

                  <div className="connection-card__actions">
                    {connection.status !== "revoked" ? (
                      <form action="/api/connections/revoke" method="post">
                        <input type="hidden" name="connectionId" value={connection.connectionId} />
                        <button className="connection-action connection-action--danger" type="submit">
                          Revoke in ASC
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
