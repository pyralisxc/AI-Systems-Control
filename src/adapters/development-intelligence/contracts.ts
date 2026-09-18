import type { JsonValue } from "../../domain/index.js";

export interface DevelopmentIntelligenceCurrentness {
  readonly acceptedSemanticCurrent?: boolean;
  readonly sourceCurrent?: boolean;
  readonly topologyCurrent?: boolean;
  readonly evidenceCurrent?: boolean;
  readonly analyzerCurrent?: boolean;
  readonly schemaSupported?: boolean;
  readonly integrityCurrent?: boolean;
  readonly checkpointError?: string | null;
}

export interface DevelopmentIntelligenceGraphSummary {
  readonly graphId?: string;
  readonly sourceFingerprint?: string | null;
  readonly topologyFingerprint?: string | null;
  readonly evidenceFingerprint?: string | null;
  readonly analyzerVersion?: string;
  readonly current?: boolean;
  readonly nodes?: number;
  readonly edges?: number;
}

export interface DevelopmentIntelligenceWorkingSummary {
  readonly graphId?: string;
  readonly sourceFingerprint?: string | null;
  readonly topologyFingerprint?: string | null;
  readonly evidenceFingerprint?: string | null;
  readonly nodes?: number;
  readonly edges?: number;
  readonly semanticNodes?: number;
  readonly semanticEdges?: number;
  readonly evidenceRecords?: number;
  readonly explicitValueConflicts?: number;
  readonly coverage?: JsonValue | null;
}

export interface DevelopmentIntelligenceGraphStatus {
  readonly project?: string;
  readonly repository?: string;
  readonly ref?: string;
  readonly revision?: string;
  readonly revisionIdentity?: JsonValue;
  readonly analyzerVersion?: string;
  readonly currentness?: DevelopmentIntelligenceCurrentness;
  readonly accepted?: DevelopmentIntelligenceGraphSummary | null;
  readonly working?: DevelopmentIntelligenceWorkingSummary;
}

export interface DevelopmentIntelligenceProjectStatus {
  readonly project: string;
  readonly repository: string;
  readonly ref: string;
  readonly upstreamSha: string | null;
  readonly upstreamError: string | null;
  readonly graph: DevelopmentIntelligenceGraphStatus | null;
  readonly graphError: string | null;
}

export interface DevelopmentIntelligenceCoverageSummary {
  readonly trackedFiles?: number;
  readonly eligibleFiles?: number;
  readonly analyzedFiles?: number;
  readonly completeFiles?: number;
  readonly partialFiles?: number;
  readonly unsupportedFiles?: number;
  readonly skippedFiles?: number;
  readonly failedFiles?: number;
}

export interface DevelopmentIntelligenceOverview {
  readonly project: string;
  readonly graphId?: string;
  readonly revision?: string | null;
  readonly role?: string;
  readonly summary?: string;
  readonly quickNotes?: readonly string[];
  readonly counts?: JsonValue;
  readonly currentness?: DevelopmentIntelligenceCurrentness | null;
  readonly coverage?: DevelopmentIntelligenceCoverageSummary | null;
  readonly highlights?: JsonValue;
  readonly areas?: JsonValue;
  readonly changes?: JsonValue;
  readonly sources?: JsonValue;
}

export interface DevelopmentIntelligenceSourceDescriptor {
  readonly id: string;
  readonly kind: string;
  readonly locator: string;
  readonly revision: string | null;
  readonly observedAt: string;
  readonly available: boolean;
  readonly error?: string;
  readonly warnings?: readonly string[];
}

export interface DevelopmentIntelligenceSources {
  readonly project: string;
  readonly graphId?: string;
  readonly revision?: string | null;
  readonly sources?: JsonValue;
  readonly observedGraphSources?: readonly DevelopmentIntelligenceSourceDescriptor[];
  readonly unavailableSourceIds?: readonly string[];
  readonly coverage?: DevelopmentIntelligenceCoverageSummary | null;
  readonly note?: string;
}

export interface DevelopmentIntelligenceClient {
  projectStatus(input: {
    readonly project: string;
    readonly checkUpstream?: boolean;
  }): Promise<DevelopmentIntelligenceProjectStatus>;

  projectOverview(input: {
    readonly project: string;
    readonly ref?: string;
  }): Promise<DevelopmentIntelligenceOverview>;

  listSources(input: {
    readonly project: string;
    readonly ref?: string;
  }): Promise<DevelopmentIntelligenceSources>;
}
