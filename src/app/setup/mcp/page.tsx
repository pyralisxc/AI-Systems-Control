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

  const view = loadMcpSetupReadinessView();

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
              detail="Standard PostgreSQL is required on Vercel so Principal, Membership, Connection, authority, and Thread state survive deployments."
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
              configured={
                view.configuration.externalIdentityIssuerConfigured &&
                view.configuration.externalIdentitySubjectConfigured
              }
              detail="Issuer + stable subject mapped to the existing ASC bootstrap Principal. Email is not the identity key."
            />
          </div>
        </section>

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
                  contract. Preview needs the resulting database URL.
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
                <h3>Bind your external identity</h3>
                <p>
                  Copy the Auth0 issuer and your stable subject into
                  <code>ASC_BOOTSTRAP_AUTH_ISSUER</code> and
                  <code>ASC_BOOTSTRAP_AUTH_SUBJECT</code>. The subject is not
                  treated as a password; it maps that external identity to
                  <code>{view.defaults.principalId}</code>.
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
