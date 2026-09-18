import {
  HostAwareReadCapabilityBindingResolver,
  InMemoryProjectRegistry
} from "../dist/application/index.js";
import {
  DevelopmentIntelligenceMcpHttpClient,
  DevelopmentIntelligenceProjectRealityProvider,
  DevelopmentIntelligenceReadBindingCandidateSource
} from "../dist/adapters/development-intelligence/index.js";
import {
  buildOwnerProjectRealityView,
  createSliceACapabilityCatalog
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

      const client = new DevelopmentIntelligenceMcpHttpClient({
        baseUrl,
        ...(process.env.DEVINT_TOKEN ? { token: process.env.DEVINT_TOKEN } : {})
      });
      const realityProvider = new DevelopmentIntelligenceProjectRealityProvider({ client });
      const candidateSource = new DevelopmentIntelligenceReadBindingCandidateSource({
        probe: client
      });
      const bindingResolver = new HostAwareReadCapabilityBindingResolver(candidateSource);

      const capabilityCatalog = createSliceACapabilityCatalog([
        {
          capabilityId: "project.observe",
          name: "Observe project reality",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          effectClass: "read",
          riskClass: "none",
          ownerSystem: "development-intelligence"
        },
        {
          capabilityId: "project.coverage",
          name: "Read project coverage",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          effectClass: "read",
          riskClass: "none",
          ownerSystem: "development-intelligence"
        },
        {
          capabilityId: "project.sources",
          name: "Read project sources",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          effectClass: "read",
          riskClass: "none",
          ownerSystem: "development-intelligence"
        }
      ]);

      const view = await buildOwnerProjectRealityView({
        composition: {
          realityProvider,
          bindingResolver,
          capabilityCatalog
        },
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
