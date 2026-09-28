import { redirect } from "next/navigation";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadMcpSetupReadinessView } from "@/web/runtime/mcp-setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Tone = "positive" | "warning" | "critical" | "neutral";

function connectionTone(state: string): Tone {
  if (state === "connected") return "positive";
  if (state === "error") return "critical";
  if (
    state === "candidate" ||
    state === "pairing" ||
    state === "ready_to_pair" ||
    state === "ready_to_test"
  ) {
    return "warning";
  }
  return "neutral";
}

function connectionLabel(state: string): string {
  const labels: Record<string, string> = {
    missing: "Connect",
    connected: "Connected",
    error: "Needs attention",
    missing_issuer: "Connect",
    ready_to_pair: "Ready to pair",
    pairing: "Pairing",
    candidate: "Approve",
    not_ready: "Waiting",
    ready_to_test: "Ready to test"
  };
  return labels[state] ?? state.replaceAll("_", " ");
}

function Check({
  label,
  configured,
  detail
}: {
  readonly label: string;
  readonly configured: boolean;
  readonly detail: string;
}) {
  return (
    <article className="setup-check">
      <div>
        <span className="eyebrow">{label}</span>
        <p>{detail}</p>
      </div>
      <span
        className="status-pill"
        data-tone={configured ? "positive" : "warning"}
      >
        <span className="status-dot" aria-hidden="true" />
        {configured ? "ready" : "missing"}
      </span>
    </article>
  );
}

function StatusPill({
  state
}: {
  readonly state: string;
}) {
  return (
    <span
      className="status-pill"
      data-tone={connectionTone(state)}
    >
      <span className="status-dot" aria-hidden="true" />
      {connectionLabel(state)}
    </span>
  );
}

export default async function McpSetupPage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login?returnTo=%2Fsetup%2Fmcp");
  }

  const view = await loadMcpSetupReadinessView();
  const nextActionCopy: Record<string, string> = {
    connect_database:
      "Connect Postgres first. ASC will detect a standard provider connection automatically.",
    repair_database:
      "The database is configured but ASC cannot read it. Check the provider connection.",
    connect_identity:
      "Connect an OAuth identity provider next. ASC only needs the canonical issuer on the normal path.",
    repair_identity:
      "The identity provider is configured but ASC cannot validate the current discovery or identity state.",
    start_pairing:
      "Start identity pairing, then complete the normal OAuth sign-in from ChatGPT.",
    complete_pairing:
      "Pairing is armed. Continue the OAuth sign-in from ChatGPT, then return here.",
    approve_identity:
      "ASC detected a verified identity. Approve it here before access is granted.",
    test_chatgpt:
      "Database and identity are connected. Connect ASC in ChatGPT and publish the first bridge checkpoint.",
    complete:
      "ASC has durable evidence from all three connections."
  };

  return (
    <main className="setup-shell">
      <div className="setup-page">
        <header className="connections-header">
          <div>
            <span className="eyebrow">ASC Setup</span>
            <h1>Connect your control plane</h1>
            <p>
              Setup should feel like signing into services. ASC discovers the
              infrastructure details it can and keeps technical overrides out
              of the normal path.
            </p>
          </div>
          <div className="connections-header__actions">
            <a className="connections-back" href="/">Back to project</a>
            <a className="connections-back" href="/pulse">Pulse</a>
          </div>
        </header>

        <section className="setup-progress">
          <div>
            <span className="eyebrow">Setup progress</span>
            <strong>
              {view.connections.completedConnections}/
              {view.connections.totalConnections} connected
            </strong>
            <p>{nextActionCopy[view.connections.nextAction]}</p>
          </div>
          <span
            className="status-pill"
            data-tone={
              view.connections.overall === "connected"
                ? "positive"
                : view.connections.overall === "ready_to_test"
                  ? "warning"
                  : "neutral"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {view.connections.overall.replaceAll("_", " ")}
          </span>
        </section>

        <section className="setup-connection-grid">
          <article
            className="setup-connection-card"
            data-state={view.connections.database}
          >
            <div className="setup-connection-card__heading">
              <div>
                <span className="setup-connection-card__number">01</span>
                <span className="eyebrow">Database</span>
                <h2>Connect Postgres</h2>
              </div>
              <StatusPill state={view.connections.database} />
            </div>

            <p>
              Give ASC durable memory for identity, connections, authority,
              Threads, and control state.
            </p>

            {view.connections.database === "connected" ? (
              <div className="setup-connection-proof">
                <strong>Durable storage is reachable.</strong>
                <span>
                  {view.configuration.durableStorageSource ===
                  "standard_database_url"
                    ? "Provider-native Postgres detected automatically."
                    : view.configuration.durableStorageSource === "asc_explicit"
                      ? "Using an explicit ASC database override."
                      : "Persistent local/self-hosted storage is active."}
                </span>
              </div>
            ) : view.connections.database === "error" ? (
              <div className="setup-connection-warning">
                <strong>Connection found, but ASC cannot read it.</strong>
                <span>
                  Check the provider/database connection before continuing.
                </span>
              </div>
            ) : (
              <a
                className="setup-primary-action"
                href="#provider-options"
              >
                Connect Postgres
              </a>
            )}
          </article>

          <article
            className="setup-connection-card"
            data-state={view.connections.identity}
          >
            <div className="setup-connection-card__heading">
              <div>
                <span className="setup-connection-card__number">02</span>
                <span className="eyebrow">Identity</span>
                <h2>Connect your sign-in</h2>
              </div>
              <StatusPill state={view.connections.identity} />
            </div>

            <p>
              ASC validates your provider, discovers signing keys, and pairs the
              verified external identity to your ASC Principal.
            </p>

            {view.connections.identity === "connected" ? (
              <div className="setup-connection-proof">
                <strong>Identity is paired.</strong>
                <span>
                  The durable binding is active. Email and copied subject IDs
                  are not used as ASC identity.
                </span>
              </div>
            ) : view.connections.identity === "missing_issuer" ? (
              <a
                className="setup-primary-action"
                href="#provider-options"
              >
                Choose identity provider
              </a>
            ) : view.connections.identity === "ready_to_pair" ? (
              <form
                method="post"
                action="/api/setup/mcp/identity-pairing"
              >
                <button
                  className="setup-primary-action"
                  type="submit"
                  name="action"
                  value="arm"
                >
                  Start identity pairing
                </button>
              </form>
            ) : view.connections.identity === "pairing" &&
              view.pairing ? (
              <div className="setup-connection-warning">
                <strong>Pairing is armed.</strong>
                <span>
                  Continue the OAuth connection from ChatGPT. ASC will detect
                  the verified identity but still deny access until you approve
                  it here.
                </span>
                <small>
                  Pairing expires at{" "}
                  {new Date(view.pairing.expiresAt).toLocaleTimeString()}.
                </small>
                <form
                  method="post"
                  action="/api/setup/mcp/identity-pairing"
                >
                  <input
                    type="hidden"
                    name="pairingId"
                    value={view.pairing.pairingId}
                  />
                  <button
                    className="setup-secondary-action"
                    type="submit"
                    name="action"
                    value="revoke"
                  >
                    Cancel pairing
                  </button>
                </form>
              </div>
            ) : view.connections.identity === "candidate" &&
              view.pairing ? (
              <div className="setup-connection-candidate">
                <strong>Verified identity detected.</strong>
                <span>
                  ASC has not granted access yet. Approve this pairing to create
                  the durable identity binding.
                </span>
                <div className="setup-inline-actions">
                  <form
                    method="post"
                    action="/api/setup/mcp/identity-pairing"
                  >
                    <input
                      type="hidden"
                      name="pairingId"
                      value={view.pairing.pairingId}
                    />
                    <button
                      className="setup-primary-action"
                      type="submit"
                      name="action"
                      value="approve"
                    >
                      Approve identity
                    </button>
                  </form>
                  <form
                    method="post"
                    action="/api/setup/mcp/identity-pairing"
                  >
                    <input
                      type="hidden"
                      name="pairingId"
                      value={view.pairing.pairingId}
                    />
                    <button
                      className="setup-secondary-action"
                      type="submit"
                      name="action"
                      value="revoke"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="setup-connection-warning">
                <strong>Identity needs attention.</strong>
                <span>
                  Check the issuer/provider connection in Advanced setup. ASC
                  will not bypass discovery or signature validation.
                </span>
              </div>
            )}
          </article>

          <article
            className="setup-connection-card"
            id="chatgpt-connection"
            data-state={view.connections.chatgpt}
          >
            <div className="setup-connection-card__heading">
              <div>
                <span className="setup-connection-card__number">03</span>
                <span className="eyebrow">ChatGPT</span>
                <h2>Connect your conversation</h2>
              </div>
              <StatusPill state={view.connections.chatgpt} />
            </div>

            <p>
              ChatGPT connects to ASC through the authenticated MCP resource.
              ASC only marks this connected after durable bridge evidence
              actually arrives.
            </p>

            {view.connections.chatgpt === "connected" ? (
              <div className="setup-connection-proof">
                <strong>Authenticated bridge activity detected.</strong>
                <span>
                  {view.chatgptEvidence.lastSeenAt
                    ? "Last observed " +
                      new Date(
                        view.chatgptEvidence.lastSeenAt
                      ).toLocaleString()
                    : "Durable ChatGPT bridge evidence is present."}
                </span>
              </div>
            ) : view.connections.chatgpt === "ready_to_test" &&
              view.urls ? (
              <>
                <div className="setup-resource">
                  <span>ASC MCP resource</span>
                  <code>{view.urls.resourceUrl}</code>
                </div>
                <a
                  className="setup-primary-action"
                  href="https://chatgpt.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open ChatGPT
                </a>
                <small className="setup-card-note">
                  Add this MCP resource from ChatGPT Developer Mode. The first
                  verified identity can be paired from this page if needed.
                </small>
              </>
            ) : (
              <div className="setup-connection-waiting">
                <strong>Waiting on the earlier connections.</strong>
                <span>
                  Database and Identity must be healthy before ChatGPT can be
                  tested.
                </span>
              </div>
            )}
          </article>
        </section>

        <section className="content-section" id="provider-options">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Connection options</span>
              <h2>Choose the providers you already prefer</h2>
              <p>
                ASC stays provider-neutral. These are onboarding recipes, not
                architecture dependencies.
              </p>
            </div>
          </div>

          <div className="setup-provider-grid">
            <article>
              <span className="eyebrow">Hosted / mature</span>
              <h3>Managed Postgres + Auth0</h3>
              <p>
                Connect any standard PostgreSQL provider, then use Auth0 or
                another standards-compatible OAuth/OIDC issuer. ASC detects the
                database URL and signing keys automatically.
              </p>
              <div className="setup-links">
                <a
                  className="connections-back"
                  href="https://auth0.com/ai"
                  target="_blank"
                  rel="noreferrer"
                >
                  Auth0
                </a>
              </div>
            </article>

            <article>
              <span className="eyebrow">Consolidated</span>
              <h3>Supabase unified</h3>
              <p>
                A dedicated ASC Supabase project can provide PostgreSQL and an
                OAuth/OIDC server in one provider. Keep it separate from
                product databases such as CardForge.
              </p>
              <div className="setup-links">
                <a
                  className="connections-back"
                  href="https://supabase.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Supabase
                </a>
              </div>
            </article>
          </div>
        </section>

        <details className="setup-advanced" id="advanced-setup">
          <summary>
            <span>
              <strong>Advanced setup & diagnostics</strong>
              <small>
                Overrides, discovery details, scopes, and provider diagnostics.
              </small>
            </span>
            <span className="setup-advanced__chevron">+</span>
          </summary>

          <div className="setup-advanced__content">
            <section>
              <span className="eyebrow">Technical checks</span>
              <div className="setup-checks">
                <Check
                  label="Durable control storage"
                  configured={
                    view.configuration.durableStorageConfigured &&
                    view.configuration.durableStorageReadable
                  }
                  detail={
                    view.configuration.durableStorageSource ===
                    "standard_database_url"
                      ? "Standard DATABASE_URL detected and readable."
                      : view.configuration.durableStorageSource ===
                          "asc_explicit"
                        ? "Explicit ASC database override detected."
                        : "No readable hosted database is currently available."
                  }
                />
                <Check
                  label="Stable MCP resource"
                  configured={view.configuration.resourceUrlConfigured}
                  detail={
                    view.configuration.resourceUrlSource === "vercel_branch"
                      ? "Derived from the stable Vercel branch URL."
                      : "Using the explicit resource URL override."
                  }
                />
                <Check
                  label="OAuth issuer"
                  configured={view.configuration.oauthIssuerConfigured}
                  detail="Canonical authorization-server issuer."
                />
                <Check
                  label="OAuth signing keys"
                  configured={view.configuration.oauthJwksConfigured}
                  detail={
                    view.configuration.oauthJwksSource === "explicit"
                      ? "Using explicit advanced JWKS override."
                      : view.configuration.oauthJwksSource === "oidc_metadata"
                        ? "Discovered through OpenID Connect metadata."
                        : view.configuration.oauthJwksSource ===
                            "oauth_metadata"
                          ? "Discovered through OAuth authorization-server metadata."
                          : "Signing-key discovery is unavailable."
                  }
                />
                <Check
                  label="Identity binding"
                  configured={view.configuration.externalIdentityBound}
                  detail="Durable issuer+subject to Principal binding."
                />
              </div>
            </section>

            <section>
              <span className="eyebrow">Defaults</span>
              <div className="setup-default-grid">
                <article>
                  <span>AccountDomain</span>
                  <code>{view.defaults.accountDomainId}</code>
                  <small>{view.defaults.accountDomainName}</small>
                </article>
                <article>
                  <span>Principal</span>
                  <code>{view.defaults.principalId}</code>
                  <small>{view.defaults.principalName}</small>
                </article>
                <article>
                  <span>Tenant claim</span>
                  <code>{view.defaults.accountDomainClaim}</code>
                  <small>{view.defaults.scopeClaim} carries scopes</small>
                </article>
                <article>
                  <span>Personal bootstrap</span>
                  <code>
                    {view.defaults.personalBootstrapEnabled
                      ? "enabled"
                      : "disabled"}
                  </code>
                  <small>same identity model as multi-user mode</small>
                </article>
              </div>
              <div className="setup-scope-list">
                {view.defaults.scopes.map((scope) => (
                  <code key={scope}>{scope}</code>
                ))}
              </div>
            </section>

            {view.urls ? (
              <section>
                <span className="eyebrow">Derived endpoints</span>
                <div className="setup-url-card">
                  <span>MCP resource</span>
                  <code>{view.urls.resourceUrl}</code>
                  <span>Resource source</span>
                  <code>
                    {view.urls.source === "vercel_branch"
                      ? "Vercel stable branch alias"
                      : "explicit override"}
                  </code>
                  <span>Protected-resource metadata</span>
                  <code>{view.urls.metadataUrl}</code>
                </div>
              </section>
            ) : null}

            <section>
              <span className="eyebrow">Provider documentation</span>
              <div className="setup-links">
                <a
                  className="connections-back"
                  href="https://developers.openai.com/plugins/build/auth"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI MCP auth
                </a>
                <a
                  className="connections-back"
                  href="https://auth0.com/ai"
                  target="_blank"
                  rel="noreferrer"
                >
                  Auth0
                </a>
                <a
                  className="connections-back"
                  href="https://supabase.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  Supabase
                </a>
              </div>
            </section>

            <div className="connections-notice">
              Conductor can read this Vercel project's deployment and
              environment metadata, but deployment/env writes are currently
              blocked by Conductor issue #182. Secret values are never rendered
              here.
            </div>
          </div>
        </details>
      </div>
    </main>
  );
}
