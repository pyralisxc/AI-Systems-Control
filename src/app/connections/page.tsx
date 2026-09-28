import { redirect } from "next/navigation";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadConnectionsControlView } from "@/web/runtime/control-registry";
import {
  githubConnectionConfigured
} from "@/web/runtime/provider-connections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function preferredExecutionCapability(
  capabilities: readonly string[]
): string | undefined {
  if (capabilities.includes("pull_request.write")) {
    return "pull_request.write";
  }
  if (capabilities.includes("issue.write")) {
    return "issue.write";
  }
  return undefined;
}

function hasExactBinding(
  bindings: readonly {
    readonly projectId: string;
    readonly capabilityScope: {
      readonly kind: "exact" | "prefix";
      readonly value: string;
    };
    readonly status: string;
  }[],
  projectId: string,
  capabilityId: string
): boolean {
  return bindings.some(
    (binding) =>
      binding.projectId === projectId &&
      binding.status === "active" &&
      binding.capabilityScope.kind === "exact" &&
      binding.capabilityScope.value === capabilityId
  );
}

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
  const githubConfigured = githubConnectionConfigured();

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
            Connect PostgreSQL with the standard <code>DATABASE_URL</code> for
            hosted/serverless mode. Use <code>ASC_CONTROL_REGISTRY_DATABASE_URL</code>
            only as an explicit database override, or <code>ASC_CONTROL_REGISTRY_PATH</code>
            for a persistent local/self-hosted volume. ASC will not write
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

        <section className="connection-provider-card">
          <div>
            <span className="eyebrow">GitHub</span>
            <h2>Connect GitHub</h2>
            <p>
              Install the configured GitHub App from ASC. Conductor verifies the
              resulting installation using its existing App credentials; ASC stores
              only safe Connection identity and capabilities.
            </p>
          </div>
          {githubConfigured ? (
            <form
              method="post"
              action="/api/connections/github/start"
            >
              <button
                className="connection-action"
                type="submit"
              >
                Connect GitHub
              </button>
            </form>
          ) : (
            <span className="connection-chip">
              provider bridge not configured
            </span>
          )}
        </section>

        <div className="connections-notice">
          GitHub App installation is the normal repository-automation connection.
          User-attributed/account-scoped GitHub authorization remains a separate
          bounded connection class rather than a pasted PAT.
        </div>

        <div className="connections-notice">
          Project binding requires Conductor to attest that this exact GitHub App
          installation covers the exact repository. Binding creates durable
          read/execution routing only; mutation still requires a separate
          approval-bound, short-lived delegation when work actually runs.
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
                    {connection.provider === "github" &&
                    connection.authenticationStrategy === "app_installation" &&
                    connection.status === "active" ? (
                      view.projects.map((project) => {
                        const executionCapability =
                          preferredExecutionCapability(
                            connection.capabilities
                          );
                        const fullyBound =
                          hasExactBinding(
                            bindings,
                            project.projectId,
                            "source.read"
                          ) &&
                          hasExactBinding(
                            bindings,
                            project.projectId,
                            "repository.read"
                          ) &&
                          Boolean(
                            executionCapability &&
                            hasExactBinding(
                              bindings,
                              project.projectId,
                              executionCapability
                            )
                          );

                        if (fullyBound) {
                          return (
                            <span
                              className="connection-chip"
                              key={project.projectId}
                            >
                              {project.name} · specialist access bound
                            </span>
                          );
                        }

                        if (
                          !executionCapability ||
                          !connection.capabilities.includes("source.read") ||
                          !connection.capabilities.includes("repository.read")
                        ) {
                          return (
                            <span
                              className="connection-chip"
                              key={project.projectId}
                            >
                              {project.name} · required GitHub capabilities unavailable
                            </span>
                          );
                        }

                        return (
                          <form
                            action="/api/connections/github/bind-project"
                            method="post"
                            key={project.projectId}
                          >
                            <input
                              type="hidden"
                              name="connectionId"
                              value={connection.connectionId}
                            />
                            <input
                              type="hidden"
                              name="projectId"
                              value={project.projectId}
                            />
                            <input
                              type="hidden"
                              name="executionCapability"
                              value={executionCapability}
                            />
                            <button
                              className="connection-action"
                              type="submit"
                            >
                              Bind {project.name} · DI read + Conductor {executionCapability}
                            </button>
                          </form>
                        );
                      })
                    ) : null}

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
