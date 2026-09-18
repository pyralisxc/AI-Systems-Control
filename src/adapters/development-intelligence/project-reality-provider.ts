import { createObservation } from "../../domain/index.js";
import type {
  EvidenceReference,
  JsonValue,
  Observation,
  Project,
  ProjectReference
} from "../../domain/index.js";
import type {
  ObserveProjectRequest,
  ProjectRealityProvider,
  ProjectRealitySnapshot,
  RealityProblem
} from "../../ports/index.js";
import type {
  DevelopmentIntelligenceClient,
  DevelopmentIntelligenceCoverageSummary,
  DevelopmentIntelligenceOverview,
  DevelopmentIntelligenceProjectStatus,
  DevelopmentIntelligenceSourceDescriptor,
  DevelopmentIntelligenceSources
} from "./contracts.js";

export const DEVELOPMENT_INTELLIGENCE_PROVIDER_ID = "development-intelligence";

export interface DevelopmentIntelligenceProjectRealityProviderOptions {
  readonly client: DevelopmentIntelligenceClient;
  readonly now?: () => string;
}

function reference(project: Project, kind: string): ProjectReference | undefined {
  return project.references.find((candidate) => candidate.kind === kind);
}

export function resolveDevelopmentIntelligenceProject(project: Project): string | undefined {
  return (
    reference(project, "development_intelligence_project")?.value ??
    reference(project, "github_repository")?.value
  );
}

export function resolveDevelopmentIntelligenceRef(project: Project): string | undefined {
  return reference(project, "development_intelligence_ref")?.value;
}

function toolEvidence(project: string, tool: string): readonly EvidenceReference[] {
  return [
    {
      kind: "development-intelligence-tool",
      locator: `development-intelligence://${project}/${tool}`
    }
  ];
}

function observation(input: {
  project: Project;
  subject: string;
  property: string;
  value: JsonValue | undefined;
  observedAt: string;
  evidence: readonly EvidenceReference[];
  quality?: Observation["quality"];
  unknownReason?: string;
}): Observation {
  return createObservation({
    projectId: input.project.projectId,
    subject: input.subject,
    property: input.property,
    value: input.value,
    ...(input.unknownReason ? { unknownReason: input.unknownReason } : {}),
    observedAt: input.observedAt,
    evidence: input.evidence,
    producingSystem: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
    quality: input.quality ?? (input.value === undefined ? "unknown" : "authoritative")
  });
}

function sourceEvidence(source: DevelopmentIntelligenceSourceDescriptor): readonly EvidenceReference[] {
  return [
    {
      kind: source.kind,
      locator: source.locator,
      ...(source.revision ? { label: `revision:${source.revision}` } : {})
    }
  ];
}

function coverageIncomplete(coverage: DevelopmentIntelligenceCoverageSummary | null | undefined): boolean {
  if (!coverage) return false;
  return (
    (coverage.partialFiles ?? 0) > 0 ||
    (coverage.skippedFiles ?? 0) > 0 ||
    (coverage.failedFiles ?? 0) > 0
  );
}

function statusObservations(
  project: Project,
  status: DevelopmentIntelligenceProjectStatus,
  observedAt: string
): Observation[] {
  const evidence = toolEvidence(status.project, "project_status");
  const output: Observation[] = [
    observation({ project, subject: "repository", property: "identity", value: status.repository, observedAt, evidence }),
    observation({ project, subject: "repository", property: "default_ref", value: status.ref, observedAt, evidence }),
    observation({
      project,
      subject: "repository",
      property: "upstream_sha",
      value: status.upstreamSha ?? undefined,
      observedAt,
      evidence,
      ...(status.upstreamSha ? {} : { unknownReason: status.upstreamError ?? "Upstream revision is unavailable." })
    })
  ];

  if (!status.graph) {
    output.push(
      observation({
        project,
        subject: "development_intelligence",
        property: "graph",
        value: undefined,
        observedAt,
        evidence,
        unknownReason: status.graphError ?? "Development Intelligence graph is unavailable."
      })
    );
    return output;
  }

  const graph = status.graph;
  output.push(
    observation({
      project,
      subject: "repository",
      property: "revision",
      value: graph.revision,
      observedAt,
      evidence,
      ...(graph.revision ? {} : { unknownReason: "Graph revision was not reported." })
    }),
    observation({
      project,
      subject: "development_intelligence",
      property: "analyzer_version",
      value: graph.analyzerVersion,
      observedAt,
      evidence,
      ...(graph.analyzerVersion ? {} : { unknownReason: "Analyzer version was not reported." })
    }),
    observation({
      project,
      subject: "development_intelligence",
      property: "currentness",
      value: graph.currentness as JsonValue | undefined,
      observedAt,
      evidence,
      quality: graph.currentness === undefined ? "unknown" : "derived",
      ...(graph.currentness === undefined ? { unknownReason: "Graph currentness was not reported." } : {})
    }),
    observation({
      project,
      subject: "development_intelligence",
      property: "accepted_graph",
      value: graph.accepted as JsonValue | undefined,
      observedAt,
      evidence,
      quality: graph.accepted === undefined ? "unknown" : "derived",
      ...(graph.accepted === undefined ? { unknownReason: "Accepted graph state was not reported." } : {})
    }),
    observation({
      project,
      subject: "development_intelligence",
      property: "working_graph",
      value: graph.working as JsonValue | undefined,
      observedAt,
      evidence,
      quality: graph.working === undefined ? "unknown" : "derived",
      ...(graph.working === undefined ? { unknownReason: "Working graph state was not reported." } : {})
    })
  );
  return output;
}

function overviewObservations(
  project: Project,
  overview: DevelopmentIntelligenceOverview,
  observedAt: string
): Observation[] {
  const evidence = toolEvidence(overview.project, "project_overview");
  const output: Observation[] = [
    observation({
      project,
      subject: "development_intelligence",
      property: "graph_id",
      value: overview.graphId,
      observedAt,
      evidence,
      ...(overview.graphId ? {} : { unknownReason: "Project overview graph identifier was not reported." })
    }),
    observation({
      project,
      subject: "development_intelligence",
      property: "coverage",
      value: overview.coverage as JsonValue | undefined,
      observedAt,
      evidence,
      quality: overview.coverage === undefined || overview.coverage === null
        ? "unknown"
        : coverageIncomplete(overview.coverage) ? "partial" : "derived",
      ...(overview.coverage === undefined || overview.coverage === null
        ? { unknownReason: "Project overview coverage was not reported." }
        : {})
    })
  ];

  if (overview.summary !== undefined) {
    output.push(observation({
      project,
      subject: "development_intelligence",
      property: "summary",
      value: overview.summary,
      observedAt,
      evidence,
      quality: "derived"
    }));
  }
  if (overview.counts !== undefined) {
    output.push(observation({
      project,
      subject: "development_intelligence",
      property: "counts",
      value: overview.counts,
      observedAt,
      evidence,
      quality: "derived"
    }));
  }
  return output;
}

function sourceObservations(project: Project, sources: DevelopmentIntelligenceSources): Observation[] {
  const output: Observation[] = [];
  for (const source of sources.observedGraphSources ?? []) {
    const evidence = sourceEvidence(source);
    output.push(
      observation({
        project,
        subject: `source:${source.id}`,
        property: "available",
        value: source.available,
        observedAt: source.observedAt,
        evidence,
        quality: source.available ? "authoritative" : "partial"
      }),
      observation({
        project,
        subject: `source:${source.id}`,
        property: "revision",
        value: source.revision ?? undefined,
        observedAt: source.observedAt,
        evidence,
        ...(source.revision ? {} : { unknownReason: source.error ?? "Source revision was not reported." })
      })
    );
  }
  return output;
}

function problem(code: string, error: unknown, retryable = true): RealityProblem {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable
  };
}

export class DevelopmentIntelligenceProjectRealityProvider implements ProjectRealityProvider {
  readonly providerId = DEVELOPMENT_INTELLIGENCE_PROVIDER_ID;
  readonly #client: DevelopmentIntelligenceClient;
  readonly #now: () => string;

  constructor(options: DevelopmentIntelligenceProjectRealityProviderOptions) {
    this.#client = options.client;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async observeProject(request: ObserveProjectRequest): Promise<ProjectRealitySnapshot> {
    const projectKey = resolveDevelopmentIntelligenceProject(request.project);
    if (!projectKey) {
      return {
        projectId: request.project.projectId,
        availability: "unavailable",
        observations: [],
        problems: [
          {
            code: "development_intelligence_project_reference_missing",
            message: "Project has neither a development_intelligence_project nor github_repository reference.",
            retryable: false
          }
        ]
      };
    }

    const observedAt = this.#now();
    const ref = resolveDevelopmentIntelligenceRef(request.project);
    const [statusResult, overviewResult, sourcesResult] = await Promise.allSettled([
      this.#client.projectStatus({ project: projectKey, checkUpstream: true }),
      this.#client.projectOverview({ project: projectKey, ...(ref ? { ref } : {}) }),
      this.#client.listSources({ project: projectKey, ...(ref ? { ref } : {}) })
    ]);

    const observations: Observation[] = [];
    const problems: RealityProblem[] = [];

    if (statusResult.status === "fulfilled") {
      observations.push(...statusObservations(request.project, statusResult.value, observedAt));
      if (statusResult.value.graphError) {
        problems.push({
          code: "development_intelligence_graph_unavailable",
          message: statusResult.value.graphError,
          retryable: true
        });
      }
      if (statusResult.value.upstreamError) {
        problems.push({
          code: "development_intelligence_upstream_unavailable",
          message: statusResult.value.upstreamError,
          retryable: true
        });
      }
    } else {
      problems.push(problem("development_intelligence_project_status_failed", statusResult.reason));
    }

    if (overviewResult.status === "fulfilled") {
      observations.push(...overviewObservations(request.project, overviewResult.value, observedAt));
      if (coverageIncomplete(overviewResult.value.coverage)) {
        problems.push({
          code: "development_intelligence_coverage_incomplete",
          message: "Development Intelligence reports partial, skipped, or failed source coverage.",
          retryable: false
        });
      }
    } else {
      problems.push(problem("development_intelligence_project_overview_failed", overviewResult.reason));
    }

    if (sourcesResult.status === "fulfilled") {
      observations.push(...sourceObservations(request.project, sourcesResult.value));
      if ((sourcesResult.value.unavailableSourceIds?.length ?? 0) > 0) {
        problems.push({
          code: "development_intelligence_sources_unavailable",
          message: `Unavailable Development Intelligence sources: ${sourcesResult.value.unavailableSourceIds?.join(", ") ?? "unknown"}.`,
          retryable: true
        });
      }
    } else {
      problems.push(problem("development_intelligence_sources_failed", sourcesResult.reason));
    }

    const fulfilledCount = [statusResult, overviewResult, sourcesResult].filter(
      (result) => result.status === "fulfilled"
    ).length;
    const availability = fulfilledCount === 0 ? "unavailable" : problems.length > 0 ? "partial" : "available";

    return {
      projectId: request.project.projectId,
      availability,
      observations,
      problems
    };
  }
}
