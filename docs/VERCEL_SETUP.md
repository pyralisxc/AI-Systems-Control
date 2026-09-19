# Vercel Setup — AI Systems Control

Status: **owner action required for first Git-connected deployment**

AI Systems Control must use its own Vercel project. Do not reuse the
`development-intelligence` project.

## Project import

In the Vercel dashboard:

1. Stay in team **Pyralis' projects** / `pyralis-projects`.
2. Add a new project by importing GitHub repository
   `pyralisxc/AI-Systems-Control`.
3. Project name: `ai-systems-control`.
4. Framework preset: **Next.js**.
5. Root directory: repository root (`./`).
6. Production branch: `main`.
7. Keep the detected install/build/output settings unless Vercel fails to
   detect Next:
   - install: `npm install`
   - build: `npm run build`
   - output: Next.js default
8. Do not attach the Development Intelligence custom domain to this project.

## Required environment variables

Set these as server-side project variables.

### ASC owner access

`ASC_OWNER_PASSWORD`
- choose a strong unique password;
- store it as a sensitive/secret variable;
- never prefix it with `NEXT_PUBLIC_`.

`ASC_SESSION_SECRET`
- generate at least 32 random bytes;
- example local generation: `openssl rand -hex 32`;
- store it as a sensitive/secret variable;
- it must be independent from the owner password.

### Development Intelligence service boundary

`DEVINT_URL=https://devint.cardforges.com`

`DEVINT_TOKEN=<same value as DI DEVINT_AGENT_TOKEN>`

Development Intelligence may remain in OAuth mode. The trusted agent token is
the first-party ASC-to-DI machine credential.

If the DI deployment does not already have a known `DEVINT_AGENT_TOKEN`,
generate a new high-entropy token and set the exact same value as:
- `DEVINT_AGENT_TOKEN` on the **development-intelligence** Vercel project;
- `DEVINT_TOKEN` on the **ai-systems-control** Vercel project.

Redeploy Development Intelligence after changing its environment variable.

Do not paste these secrets into chat, GitHub issues, or source files.

### Initial owner defaults

`ASC_DEFAULT_REPOSITORY=pyralisxc/AI-Systems-Control`

`ASC_DESIRED_DEFAULT_REF=main`

Optional:
- `ASC_FRESHNESS_WARNING_SECONDS=300`
- `ASC_FRESHNESS_STALE_SECONDS=1800`

## Environment targets

For the first deployment:
- apply owner-auth secrets and DI credentials to **Production**;
- apply them to **Preview** only if preview deployments need live private
  project intelligence;
- Development values can stay local.

## Deployment protection

ASC has its own application-level owner login. During bootstrap, Vercel
Authentication can also be enabled as defense in depth, especially for
Preview deployments.

Recommended initial posture:
- protect all Previews with Vercel Authentication;
- optionally protect Production too while the product is owner-only;
- keep ASC's own login enabled even when Vercel Authentication is enabled.

## First hosted acceptance

After the production deployment is READY:

1. `GET /api/health` should report:
   - `status: "ok"`
   - `ownerAuthConfigured: true`
   - `developmentIntelligenceConfigured: true`
   - `mutationSurface: "disabled"`
2. Opening `/` while signed out should redirect to `/login`.
3. Wrong password must fail.
4. Correct password must create the owner session and open the workspace.
5. Open `pyralisxc/AI-Systems-Control`.
6. Confirm DI-backed observations/evidence appear.
7. Confirm capability bindings are available rather than permission-blocked.
8. Sign out and confirm project reality is no longer accessible.
9. Check Vercel runtime errors/logs before calling the deployment accepted.

Only after this acceptance should issue #20 close.
