import type {
  ReadBindingCandidate,
  ReadBindingCandidateRequest,
  ReadBindingCandidateSource
} from "../../application/index.js";
import {
  DEVELOPMENT_INTELLIGENCE_PROVIDER_ID
} from "./project-reality-provider.js";
import {
  DevelopmentIntelligenceTransportError
} from "./mcp-http-client.js";

export interface DevelopmentIntelligenceProbe {
  probe(): Promise<void>;
}

export interface DevelopmentIntelligenceBindingCandidateSourceOptions {
  readonly probe: DevelopmentIntelligenceProbe;
  readonly host?: string;
  readonly adapter?: string;
}

export class DevelopmentIntelligenceReadBindingCandidateSource implements ReadBindingCandidateSource {
  readonly #probe: DevelopmentIntelligenceProbe;
  readonly #host: string;
  readonly #adapter: string;

  constructor(options: DevelopmentIntelligenceBindingCandidateSourceOptions) {
    this.#probe = options.probe;
    this.#host = options.host ?? "development-intelligence";
    this.#adapter = options.adapter ?? "development-intelligence-mcp-http";
  }

  async listCandidates(
    request: ReadBindingCandidateRequest
  ): Promise<readonly ReadBindingCandidate[]> {
    const supported = request.capability.ownerSystem === DEVELOPMENT_INTELLIGENCE_PROVIDER_ID;
    if (!supported) {
      return [{
        bindingId: `di:${request.capability.capabilityId}:${this.#host}`,
        capabilityId: request.capability.capabilityId,
        host: this.#host,
        provider: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
        adapter: this.#adapter,
        permissionState: "not_required",
        supported: false,
        adapterAvailable: true,
        reason: `Capability ${request.capability.capabilityId} is owned by ${request.capability.ownerSystem}, not Development Intelligence.`
      }];
    }

    try {
      await this.#probe.probe();
      return [{
        bindingId: `di:${request.capability.capabilityId}:${this.#host}`,
        capabilityId: request.capability.capabilityId,
        host: this.#host,
        provider: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
        adapter: this.#adapter,
        permissionState: "granted",
        supported: true,
        adapterAvailable: true
      }];
    } catch (error) {
      const authorizationBlocked =
        error instanceof DevelopmentIntelligenceTransportError &&
        (error.status === 401 || error.status === 403);

      return [{
        bindingId: `di:${request.capability.capabilityId}:${this.#host}`,
        capabilityId: request.capability.capabilityId,
        host: this.#host,
        provider: DEVELOPMENT_INTELLIGENCE_PROVIDER_ID,
        adapter: this.#adapter,
        permissionState: authorizationBlocked ? "blocked" : "unknown",
        supported: true,
        adapterAvailable: authorizationBlocked,
        reason: error instanceof Error ? error.message : String(error)
      }];
    }
  }
}
