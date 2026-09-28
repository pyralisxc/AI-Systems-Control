import { redirect } from "next/navigation";

import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import { loadMcpSetupReadinessView } from "@/web/runtime/mcp-setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function status(
  configured: boolean
): "positive" | "warning" {
  return configured ? "positive" : "warning";
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
        data-tone={status(configured)}
      >
        <span className="status-dot" aria-hidden="true" />
        {configured ? "ready" : "missing"}
      </span>
    </article>
  );
}

export default async function McpSetupPage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login?returnTo=%2Fsetup%2Fmcp");
  }

  const view = await loadMcpSetupReadinessView();

  return (
    <main className="setup-shell">
      <div className="setup-page">
        <header className="connections-header">
          <div>
            <span className="eyebrow">ASC Setup</span>
            <h1>MCP + OAuth readiness</h1>
            <p>
              Presence-only setup diagnostics. ASC never renders bearer tokens,
              authorization codes, database URLs, client secrets, or signing
              credentials here.
            </p>
          </div>
          <div className="connections-header__actions">
            <a className="connections-back" href="/">Back to project</a>
            <a className="connections-back" href="/pulse">Pulse</a>
          </div>
        </header>

        <section className="setup-readiness">
          <div>
            <span className="eyebrow">Current gate</span>
            <h2>{view.readiness.state.replaceAll("_", " ")}</h2>
            <p>{view.readiness.summary}</p>
          </div>
          <span
            className="status-pill"
            data-tone={
              view.readiness.state === "ready_for_mcp_test"
                ? "positive"
                : "warning"
            }
          >
            <span className="status-dot" aria-hidden="true" />
            {view.readiness.blockers.length === 0
              ? "test ready"
              : view.readiness.blockers.length + " blocker" +
                (view.readiness.blockers.length === 1 ? "" : "s")}
          </span>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Required infrastructure</span>
              <h2>What ASC still needs</h2>
              <p>
                These checks report only whether configuration exists. Secret
                values are intentionally unavailable to this page.
              </p>
            </div>
          </div>

          <div className="setup-checks">
            <Check
              label="Durable control storage"
              configured={view.configuration.durableStorageConfigured}
              detail={
                view.configuration.durableStorageSource === "standard_database_url"
                  ? "Connected through standard DATABASE_URL. ASC detected the provider-native Postgres connection automatically."
                  : view.configuration.durableStorageSource === "asc_explicit"
                    ? "Connected through the explicit ASC database override."
                    : "Connect standard PostgreSQL. On Vercel, native Postgres integrations commonly provide DATABASE_URL automatically; ASC detects it without requiring a duplicate ASC-specific variable."
              }
            />
            <Check
              label="Stable MCP resource URL"
              configured={view.configuration.resourceUrlConfigured}
              detail="On Vercel Preview, ASC derives this automatically from VERCEL_BRANCH_URL. ASC_MCP_RESOURCE_URL is only an explicit override or non-Vercel fallback."
            />
            <Check
              label="OAuth issuer"
              configured={view.configuration.oauthIssuerConfigured}
              detail="The external authorization server's canonical issuer. ASC validates it exactly."
            />
            <Check
              label="OAuth signing keys"
              configured={view.configuration.oauthJwksConfigured}
              detail="JWKS endpoint used by ASC to verify access-token signatures."
            />
            <Check
              label="External identity binding"
              configured={view.configuration.externalIdentityBound}
              detail={
                view.configuration.externalIdentityBound
                  ? "A verified external identity is durably bound to the ASC bootstrap Principal."
                  : "Pair identity through a normal OAuth sign-in. ASC detects the verified subject and waits for explicit owner approval before binding it."
              }
            />
          </div>
        </section>


        {view.configuration.durableStorageConfigured &&
        view.configuration.oauthIssuerConfigured &&
        !view.configuration.externalIdentityBound ? (
          <section className="content-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Identity connection</span>
                <h2>Pair your sign-in</h2>
                <p>
                  No subject copying. Arm pairing here, complete the normal
                  ChatGPT/MCP OAuth sign-in, then approve the verified identity
                  that ASC detects.
                </p>
              </div>
            </div>

            {!view.configuration.identityStateReadable ? (
              <div className="connections-notice">
                ASC can see that storage is configured, but the identity
                directory is not currently readable. Check the database
                connection before pairing.
              </div>
            ) : view.pairing?.state === "candidate_detected" ? (
              <div className="setup-pairing setup-pairing--detected">
                <div>
                  <span className="eyebrow">Verified identity detected</span>
                  <strong>Waiting for your approval</strong>
                  <p>
                    The OAuth token was cryptographically valid and matched the
                    configured issuer/AccountDomain, but ASC has not granted it
                    access yet. Approving creates the durable identity binding.
                  </p>
                </div>
                <div className="setup-pairing__actions">
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
                      className="relay-action relay-action--approve"
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
                      className="relay-action relay-action--reject"
                      type="submit"
                      name="action"
                      value="revoke"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ) : view.pairing?.state === "armed" ? (
              <div className="setup-pairing">
                <div>
                  <span className="eyebrow">Pairing armed</span>
                  <strong>Complete your OAuth sign-in</strong>
                  <p>
                    Connect ASC from ChatGPT/MCP now. The first verified,
                    unbound identity from the configured issuer will be captured
                    as a candidate, but it will remain denied until you approve
                    it here.
                  </p>
                  <small>
                    Pairing expires at{" "}
                    {new Date(view.pairing.expiresAt).toLocaleTimeString()}.
                  </small>
                </div>
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
                    className="relay-action relay-action--reject"
                    type="submit"
                    name="action"
                    value="revoke"
                  >
                    Cancel pairing
                  </button>
                </form>
              </div>
            ) : (
              <div className="setup-pairing">
                <div>
                  <span className="eyebrow">Not paired</span>
                  <strong>Connect identity like a sign-in</strong>
                  <p>
                    Start a ten-minute pairing window, then complete the normal
                    OAuth flow from ChatGPT. ASC never asks you to paste your
                    provider subject identifier.
                  </p>
                </div>
                <form
                  method="post"
                  action="/api/setup/mcp/identity-pairing"
                >
                  <button
                    className="relay-action relay-action--approve"
                    type="submit"
                    name="action"
                    value="arm"
                  >
                    Start identity pairing
                  </button>
                </form>
              </div>
            )}
          </section>
        ) : null}

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Built-in defaults</span>
              <h2>No environment variable needed</h2>
              <p>
                These values already have safe code defaults. You can override
                them later, but they are not setup blockers.
              </p>
            </div>
          </div>

          <div className="setup-default-grid">
            <article>
              <span>AccountDomain</span>
              <code>{view.defaults.accountDomainId}</code>
              <small>{view.defaults.accountDomainName}</small>
            </article>
            <article>
              <span>Bootstrap Principal</span>
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
                {view.defaults.personalBootstrapEnabled ? "enabled" : "disabled"}
              </code>
              <small>disable when federated provisioning owns identity</small>
            </article>
          </div>

          <div className="setup-scope-list">
            {view.defaults.scopes.map((scope) => (
              <code key={scope}>{scope}</code>
            ))}
          </div>
        </section>

        {view.urls ? (
          <section className="content-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Derived endpoints</span>
                <h2>OAuth resource discovery</h2>
              </div>
            </div>
            <div className="setup-url-card">
              <span>MCP resource</span>
              <code>{view.urls.resourceUrl}</code>
              <span>Source</span>
              <code>
                {view.urls.source === "vercel_branch"
                  ? "Vercel stable branch alias"
                  : "ASC_MCP_RESOURCE_URL override"}
              </code>
              <span>Protected-resource metadata</span>
              <code>{view.urls.metadataUrl}</code>
            </div>
          </section>
        ) : null}

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Recommended first proof</span>
              <h2>Auth0 quick path</h2>
              <p>
                ASC stays provider-neutral, but Auth0 is currently a practical
                first IdP because it has first-class MCP authorization support.
              </p>
            </div>
          </div>

          <div className="setup-steps">
            <article>
              <strong>1</strong>
              <div>
                <h3>Provision durable PostgreSQL</h3>
                <p>
                  Neon, Supabase Postgres, ordinary hosted PostgreSQL, or your
                  future self-hosted PostgreSQL all satisfy the same ASC store
                  contract. Provider-native <code>DATABASE_URL</code> is detected
                  automatically; <code>ASC_CONTROL_REGISTRY_DATABASE_URL</code> is
                  only an advanced override.
                </p>
              </div>
            </article>
            <article>
              <strong>2</strong>
              <div>
                <h3>Create the Auth0 MCP/API resource</h3>
                <p>
                  Use the exact ASC MCP resource URL as the API identifier /
                  audience, enable MCP-compatible OAuth client registration and
                  PKCE, and expose the three ASC scopes shown above.
                </p>
              </div>
            </article>
            <article>
              <strong>3</strong>
              <div>
                <h3>Add tenant context to the token</h3>
                <p>
                  Include <code>{view.defaults.accountDomainClaim}</code> with
                  value <code>{view.defaults.accountDomainId}</code>. ASC will
                  still verify that the resolved Principal has active
                  Membership in that domain.
                </p>
              </div>
            </article>
            <article>
              <strong>4</strong>
              <div>
                <h3>Pair your sign-in</h3>
                <p>
                  Click <strong>Start identity pairing</strong>, complete the
                  OAuth sign-in from ChatGPT/MCP, then approve the detected
                  identity here. The manual subject environment variables remain
                  only as an advanced/bootstrap compatibility option.
                </p>
              </div>
            </article>
            <article>
              <strong>5</strong>
              <div>
                <h3>Run MCP Inspector, then ChatGPT</h3>
                <p>
                  Once this page says <strong>ready for mcp test</strong>, use
                  MCP Inspector to prove discovery/scopes first, then connect
                  the same URL in ChatGPT Developer Mode.
                </p>
              </div>
            </article>
          </div>

          <div className="setup-links">
            <a
              className="connections-back"
              href="https://developers.openai.com/plugins/build/auth"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI MCP auth guide
            </a>
            <a
              className="connections-back"
              href="https://auth0.com/ai"
              target="_blank"
              rel="noreferrer"
            >
              Auth0 for AI / MCP
            </a>
            <a
              className="connections-back"
              href="https://vercel.com/blog/branch-domains"
              target="_blank"
              rel="noreferrer"
            >
              Vercel Branch Domains
            </a>
          </div>
        </section>

        <div className="connections-notice">
          Conductor can currently read this Vercel project's environment
          metadata, but Preview environment writes are blocked by Conductor
          issue #182. Once that routing bug is fixed, safe non-secret Preview
          setup values can be applied from the development flow instead of
          manually.
        </div>
      </div>
    </main>
  );
}
