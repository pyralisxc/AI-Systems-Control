# ASC Web Runtime

Status: **implemented initial shell**

## Runtime choice

The canonical owner website uses Next.js App Router on Node 22, aligned with the proven CardForge web runtime while preserving AI Systems Control's independent domain/application core.

The runtime is intentionally split:

- `tsconfig.core.json` compiles the control-plane core to `dist/`.
- `tsconfig.json` type-checks the Next application.
- the web layer consumes core contracts; core domain/ports do not depend on Next or React.

This is a source-lineage decision, not a wholesale CardForge copy. Generic design-system extraction remains owned by the separate Web Foundation boundary.

## First surface

The root Project Workspace provides:

- GitHub project selection;
- Project + Workspace identity;
- reality availability;
- observed vs inferred truth;
- evidence and freshness;
- desired state + drift;
- read capability bindings and block reasons;
- explicit problems/uncertainty;
- no mutation controls.

The page is server-rendered and dynamic. Development Intelligence credentials remain server-side.

## Runtime endpoints

- `GET /` — owner Project Workspace.
- `GET /api/health` — ASC service health/configuration posture.
- `GET /api/project-reality?repository=owner/repository` — normalized Slice A owner view.

## Environment

See `.env.example`.

When `DEVINT_URL` is absent, the owner view fails explicitly into an unavailable Development Intelligence state instead of fabricating project reality.

When the DI deployment requires a machine credential, `DEVINT_TOKEN` remains server-only.

## Security boundary

This first shell does not introduce provider mutation. Do not add provider write controls until the Action/policy/authorization path is implemented.

Before exposing private repository intelligence on a public production hostname, add the ASC owner-auth boundary or enforce equivalent deployment protection. The project-reality route must be treated as owner data when DI can inspect private sources.
