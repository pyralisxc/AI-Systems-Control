import { redirect } from "next/navigation";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadConnectionsControlView } from "@/web/runtime/control-registry";
import {
  githubConnectionConfigured,
  vercelConnectionConfigured
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

function preferredVercelExecutionCapability(
  capabilities: readonly string[]
): string | undefined {
  if (capabilities.length === 0) {
    return "deployment.write";
  }
  if (capabilities.includes("deployment.write")) {
    return "deployment.write";
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

type ConnectionsSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

function param(
  searchParams: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = searchParams[name];
  return Array.isArray(value) ? value[0] : value;
}

function feedback(
  searchParams: Record<string, string | string[] | undefined>
): { readonly tone: "positive" | "warning"; readonly message: string } | undefined {
  if (param(searchParams, "connected") === "github") {
    return {
      tone: "positive",
      message: "GitHub Connection verified and reconciled."
    };
  }
  if (param(searchParams, "connected") === "vercel") {
    return {
      tone: "positive",
      message: "Vercel Connections refreshed from Conductor without importing provider credentials."
    };
  }
  if (param(searchParams, "vercelSync") === "error") {
    return {
      tone: "warning",
      message: "Vercel Connection discovery is unavailable. Existing ASC authority was not broadened."
    };
  }
  if (param(searchParams, "vercelBinding") === "connected") {
    return {
      tone: "positive",
      message: "Vercel Project routing is bound to an exact provider project."
    };
  }
  if (param(searchParams, "vercelBinding") === "error") {
    return {
      tone: "warning",
      message: "Vercel Project binding could not be attested. Existing authority was not broadened."
    };
  }
  if (param(searchParams, "githubBinding") === "connected") {
    return {
      tone: "positive",
      message: "Project specialist access is bound to the verified GitHub Connection."
    };
  }
  if (param(searchParams, "githubBinding") === "error") {
    return {
      tone: "warning",
      message: "GitHub Project binding could not be verified. Existing authority was not broadened."
    };
  }
  if (param(searchParams, "revoked") === "connection") {
    return {
      tone: "positive",
      message: "Connection revoked in ASC. Dependent authority will fail closed."
    };
  }
  return undefined;
}

function verifiedCopy(value: string | undefined): string {
  if (!value) return "not yet verified";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "verification time unavailable";
  return new Date(timestamp).toLocaleString();
}

export default async function ConnectionsPage({
  searchParams
}: {
  readonly searchParams?: ConnectionsSearchParams;
}) {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login?returnTo=%2Fconnections");
  }

  const view = await loadConnectionsControlView();
  const githubConfigured = githubConnectionConfigured();
  const vercelConfigured = vercelConnectionConfigured();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const currentFeedback = feedback(resolvedSearchParams);

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
  const attention = view.connections.filter(
    (connection) =>
      connection.status === "reconnect_required" ||
      connection.status === "unavailable"
  ).length;
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

        {currentFeedback ? (
          <div
            className="connection-feedback"
            data-tone={currentFeedback.tone}
            role="status"
          >
            {currentFeedback.message}
          </div>
        ) : null}

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
          <article className="metric-card">
            <span>Needs attention</span>
            <strong>{attention}</strong>
            <small>unavailable / reconnect required</small>
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

        <section className="connection-provider-card">
          <div>
            <span className="eyebrow">Vercel</span>
            <h2>Refresh Vercel Connections</h2>
            <p>
              Import the safe identities of Vercel installations already connected
              through Conductor. Provider credentials stay in Conductor; ASC stores
              only Connection identity, health, capabilities, and Project routing.
            </p>
          </div>
          {vercelConfigured ? (
            <form
              method="post"
              action="/api/connections/vercel/sync"
            >
              <button
                className="connection-action"
                type="submit"
              >
                Refresh Vercel
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
                      <strong>Authentication</strong> · {connection.authenticationStrategy.replaceAll("_", " ")}
                    </div>
                    <div>
                      <strong>Generation</strong> · {connection.generation}
                    </div>
                    <div>
                      <strong>Last verified</strong> · {verifiedCopy(connection.lastVerifiedAt)}
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
                            <div
                              className="connection-binding"
                              data-status={binding.status}
                              key={binding.bindingId}
                            >
                              <div className="connection-binding__heading">
                                <strong>{boundProject?.name ?? binding.projectId}</strong>
                                <span
                                  className="status-pill"
                                  data-tone={binding.status === "active" ? "positive" : "critical"}
                                >
                                  <span className="status-dot" aria-hidden="true" />
                                  {binding.status}
                                </span>
                              </div>
                              <span>
                                {binding.environment ?? "all environments"} · {binding.capabilityScope.kind}:{binding.capabilityScope.value}
                              </span>
                              <span>
                                {binding.selection} selection
                                {binding.resource
                                  ? " · " + binding.resource.kind + ":" + binding.resource.value
                                  : ""}
                              </span>
                              {binding.approvalRequiredFor.length > 0 ? (
                                <span>
                                  owner approval required for {binding.approvalRequiredFor.join(", ")}
                                </span>
                              ) : null}
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
                    githubConfigured &&
                    (connection.status === "reconnect_required" ||
                      connection.status === "unavailable") ? (
                      <form
                        method="post"
                        action="/api/connections/github/start"
                      >
                        <button
                          className="connection-action"
                          type="submit"
                        >
                          Reconnect GitHub
                        </button>
                      </form>
                    ) : null}

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

                    {connection.provider === "vercel" &&
                    connection.authenticationStrategy === "delegated_service" &&
                    connection.status === "active" ? (
                      view.projects.map((project) => {
                        const executionCapability =
                          preferredVercelExecutionCapability(
                            connection.capabilities
                          );
                        const fullyBound =
                          hasExactBinding(
                            bindings,
                            project.projectId,
                            "deployment.read"
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
                              key={"vercel:" + project.projectId}
                            >
                              {project.name} · Vercel routing bound
                            </span>
                          );
                        }

                        return (
                          <form
                            action="/api/connections/vercel/bind-project"
                            method="post"
                            key={"vercel:" + project.projectId}
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
                            {executionCapability ? (
                              <input
                                type="hidden"
                                name="executionCapability"
                                value={executionCapability}
                              />
                            ) : null}
                            <button
                              className="connection-action"
                              type="submit"
                            >
                              Bind {project.name} · Vercel
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
