import { redirect } from "next/navigation";
import {
  normalizeOwnerReturnPath
} from "../../../dist/application/index.js";
import {
  isOwnerAuthenticated,
  ownerAuthConfigured
} from "@/web/auth/owner-auth";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  readonly searchParams: Promise<{
    readonly returnTo?: string | readonly string[];
    readonly error?: string | readonly string[];
  }>;
}

function scalar(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = normalizeOwnerReturnPath(scalar(params.returnTo));
  const error = scalar(params.error);

  if (await isOwnerAuthenticated()) {
    redirect(returnTo);
  }

  const configured = ownerAuthConfigured();

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-lockup login-brand">
          <div className="brand-mark">ASC</div>
          <div>
            <strong>AI Systems Control</strong>
            <span>Owner access</span>
          </div>
        </div>

        <div className="login-copy">
          <span className="eyebrow">Private control plane</span>
          <h1>Sign in to the owner console.</h1>
          <p>
            Project reality may include private repository intelligence.
            Access is restricted before the workspace or project-reality API
            is evaluated.
          </p>
        </div>

        {!configured ? (
          <div className="login-warning">
            Owner access is not configured. Set
            <code>ASC_OWNER_PASSWORD</code> and
            <code>ASC_SESSION_SECRET</code> in the server environment,
            then redeploy.
          </div>
        ) : (
          <form className="login-form" method="post" action="/api/auth/login">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label htmlFor="password">Owner password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
            {error === "invalid" ? (
              <p className="login-error">The password was not accepted.</p>
            ) : null}
            <button type="submit">Enter control plane</button>
          </form>
        )}

        <div className="login-note">
          Session cookies are HttpOnly, SameSite=Strict, and signed with a
          deployment-only secret. No owner credential is sent to the browser
          after sign-in.
        </div>
      </section>
    </main>
  );
}
