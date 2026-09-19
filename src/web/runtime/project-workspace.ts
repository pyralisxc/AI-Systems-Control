import {
  InMemoryProjectRegistry
} from "../../../dist/application/index.js";
import {
  createSliceADevelopmentIntelligenceComposition,
  createUnavailableSliceAComposition
} from "../../../dist/composition/index.js";
import type { OwnerProjectRealityView } from "../../../dist/slice-a/index.js";
import { buildOwnerProjectRealityView } from "../../../dist/slice-a/index.js";

const DEFAULT_REPOSITORY = "pyralisxc/AI-Systems-Control";

function positiveSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultRepository(): string {
  return process.env.ASC_DEFAULT_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
}

export async function loadProjectWorkspace(
  repositoryInput: string
): Promise<OwnerProjectRealityView> {
  const registry = new InMemoryProjectRegistry();
  const project = registry.resolveOrRegisterGithubProject({
    repository: repositoryInput
  });

  const desiredDefaultRef = process.env.ASC_DESIRED_DEFAULT_REF?.trim();
  const desiredStateOverlay = desiredDefaultRef
    ? [{
        projectId: project.projectId,
        scope: "repository",
        key: "default_ref",
        value: desiredDefaultRef,
        authority: "owner-web",
        effectiveAt: new Date().toISOString()
      }]
    : [];

  const workspace = {
    workspaceId: `owner:${project.projectId}`,
    projectId: project.projectId,
    selectedHost: "development-intelligence",
    desiredStateOverlay
  };

  const baseUrl = process.env.DEVINT_URL?.trim();
  const composition = baseUrl
    ? createSliceADevelopmentIntelligenceComposition({
        baseUrl,
        ...(process.env.DEVINT_TOKEN?.trim()
          ? { token: process.env.DEVINT_TOKEN.trim() }
          : {})
      })
    : createUnavailableSliceAComposition(
        "Development Intelligence is not configured for this ASC runtime. Set DEVINT_URL and, when required, DEVINT_TOKEN on the server."
      );

  return await buildOwnerProjectRealityView({
    composition,
    project,
    workspace,
    freshnessPolicy: {
      warningAfterSeconds: positiveSeconds(
        process.env.ASC_FRESHNESS_WARNING_SECONDS,
        300
      ),
      staleAfterSeconds: positiveSeconds(
        process.env.ASC_FRESHNESS_STALE_SECONDS,
        1800
      )
    }
  });
}
