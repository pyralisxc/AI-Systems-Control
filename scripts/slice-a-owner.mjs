import {
  InMemoryProjectRegistry
} from "../dist/application/index.js";
import {
  createSliceADevelopmentIntelligenceComposition
} from "../dist/composition/index.js";
import {
  buildOwnerProjectRealityView
} from "../dist/slice-a/index.js";

const repository = process.argv[2];
if (!repository) {
  console.error("Usage: npm run slice-a -- owner/repository");
  process.exitCode = 2;
} else {
  const baseUrl = process.env.DEVINT_URL;
  if (!baseUrl) {
    console.error("DEVINT_URL is required and must point to the Development Intelligence server.");
    process.exitCode = 2;
  } else {
    try {
      const registry = new InMemoryProjectRegistry();
      const project = registry.resolveOrRegisterGithubProject({ repository });

      const desiredDefaultRef = process.env.ASC_DESIRED_DEFAULT_REF;
      const desiredStateOverlay = desiredDefaultRef
        ? [{
            projectId: project.projectId,
            scope: "repository",
            key: "default_ref",
            value: desiredDefaultRef,
            authority: "owner-cli",
            effectiveAt: new Date().toISOString()
          }]
        : [];

      const workspace = {
        workspaceId: `slice-a:${project.projectId}`,
        projectId: project.projectId,
        selectedHost: "development-intelligence",
        desiredStateOverlay
      };

      const composition = createSliceADevelopmentIntelligenceComposition({
        baseUrl,
        ...(process.env.DEVINT_TOKEN ? { token: process.env.DEVINT_TOKEN } : {})
      });

      const view = await buildOwnerProjectRealityView({
        composition,
        project,
        workspace,
        freshnessPolicy: {
          warningAfterSeconds: Number(process.env.ASC_FRESHNESS_WARNING_SECONDS ?? 300),
          staleAfterSeconds: Number(process.env.ASC_FRESHNESS_STALE_SECONDS ?? 1800)
        }
      });

      process.stdout.write(JSON.stringify(view, null, 2) + "\n");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
