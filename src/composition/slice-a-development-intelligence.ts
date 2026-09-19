import {
  HostAwareReadCapabilityBindingResolver,
  type ReadBindingCandidate,
  type ReadBindingCandidateRequest,
  type ReadBindingCandidateSource
} from "../application/index.js";
import {
  DevelopmentIntelligenceMcpHttpClient,
  DevelopmentIntelligenceProjectRealityProvider,
  DevelopmentIntelligenceReadBindingCandidateSource,
  DEVELOPMENT_INTELLIGENCE_PROVIDER_ID
} from "../adapters/development-intelligence/index.js";
import type { Capability } from "../domain/index.js";
import type {
  ObserveProjectRequest,
  ProjectRealityProvider,
  ProjectRealitySnapshot
} from "../ports/index.js";
import {
  createSliceACapabilityCatalog,
  type SliceAComposition
} from "../slice-a/index.js";

export const SLICE_A_DEVELOPMENT_INTELLIGENCE_CAPABILITIES: readonly Capability[] =
  Object.freeze([
    Object.freeze({
      capabilityId: "project.observe",
      name: "Observe project reality",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      effectClass: "read",
      riskClass: "none",
      ownerSystem: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID
    }),
    Object.freeze({
      capabilityId: "project.coverage",
      name: "Read project coverage",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      effectClass: "read",
      riskClass: "none",
      ownerSystem: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID
    }),
    Object.freeze({
      capabilityId: "project.sources",
      name: "Read project sources",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      effectClass: "read",
      riskClass: "none",
      ownerSystem: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID
    })
  ]);

export interface SliceADevelopmentIntelligenceCompositionOptions {
  readonly baseUrl: string;
  readonly token?: string;
}

export function createSliceADevelopmentIntelligenceComposition(
  options: SliceADevelopmentIntelligenceCompositionOptions
): SliceAComposition {
  const client = new DevelopmentIntelligenceMcpHttpClient({
    baseUrl: options.baseUrl,
    ...(options.token ? { token: options.token } : {})
  });
  const realityProvider = new DevelopmentIntelligenceProjectRealityProvider({ client });
  const candidateSource = new DevelopmentIntelligenceReadBindingCandidateSource({
    probe: client
  });

  return Object.freeze({
    realityProvider,
    bindingResolver: new HostAwareReadCapabilityBindingResolver(candidateSource),
    capabilityCatalog: createSliceACapabilityCatalog(
      SLICE_A_DEVELOPMENT_INTELLIGENCE_CAPABILITIES
    )
  });
}

class UnavailableProjectRealityProvider implements ProjectRealityProvider {
  readonly providerId = DEVELOPMENT_INTELLIGENCE_PROVIDER_ID;
  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  async observeProject(
    request: ObserveProjectRequest
  ): Promise<ProjectRealitySnapshot> {
    return {
      projectId: request.project.projectId,
      availability: "unavailable",
      observations: [],
      problems: [{
        code: "development_intelligence_not_configured",
        message: this.#reason,
        retryable: false
      }]
    };
  }
}

class UnavailableReadBindingCandidateSource implements ReadBindingCandidateSource {
  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  async listCandidates(
    request: ReadBindingCandidateRequest
  ): Promise<readonly ReadBindingCandidate[]> {
    return [{
      bindingId: `di:${request.capability.capabilityId}:development-intelligence`,
      capabilityId: request.capability.capabilityId,
      host: "development-intelligence",
      provider: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
      adapter: "development-intelligence-mcp-http",
      permissionState: "unknown",
      supported:
        request.capability.ownerSystem === DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
      adapterAvailable: false,
      reason: this.#reason
    }];
  }
}

export function createUnavailableSliceAComposition(reason: string): SliceAComposition {
  return Object.freeze({
    realityProvider: new UnavailableProjectRealityProvider(reason),
    bindingResolver: new HostAwareReadCapabilityBindingResolver(
      new UnavailableReadBindingCandidateSource(reason)
    ),
    capabilityCatalog: createSliceACapabilityCatalog(
      SLICE_A_DEVELOPMENT_INTELLIGENCE_CAPABILITIES
    )
  });
}
