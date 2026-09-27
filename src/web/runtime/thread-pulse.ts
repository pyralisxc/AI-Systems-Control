import { createHash } from "node:crypto";

import {
  JsonFileThreadStore,
  PostgresThreadStore
} from "../../../dist/adapters/index.js";
import {
  BridgedThreadService,
  FounderRelayService,
  OwnerAutonomyReviewService,
  RelayCalibrationService
} from "../../../dist/application/index.js";
import type {
  ThreadSnapshot,
  ThreadStore
} from "../../../dist/ports/index.js";
import {
  controlRegistryConfigured,
  controlRegistryDatabaseUrl,
  controlRegistryPath,
  controlRegistryServices,
  controlRegistryServicesForDomain,
  defaultAccountDomainId
} from "./control-registry";

const postgresThreadStores = new Map<string, PostgresThreadStore>();

function localTenantSuffix(accountDomainId: string): string {
  return createHash("sha256")
    .update(accountDomainId)
    .digest("hex")
    .slice(0, 20);
}

export function threadStoreForDomain(
  accountDomainIdInput: string
): ThreadStore {
  const accountDomainId = accountDomainIdInput.trim();
  if (!accountDomainId) {
    throw new Error("ThreadStore AccountDomain context is required.");
  }

  const databaseUrl = controlRegistryDatabaseUrl();
  if (databaseUrl) {
    const cacheKey = databaseUrl + "\u0000" + accountDomainId;
    const existing = postgresThreadStores.get(cacheKey);
    if (existing) return existing;

    const store = PostgresThreadStore.fromConnectionString(
      databaseUrl,
      accountDomainId
    );
    postgresThreadStores.set(cacheKey, store);
    return store;
  }

  const path = controlRegistryPath();
  if (path) {
    if (accountDomainId === defaultAccountDomainId()) {
      return new JsonFileThreadStore(path + ".threads", accountDomainId);
    }
    return new JsonFileThreadStore(
      path + ".threads.domain-" + localTenantSuffix(accountDomainId),
      accountDomainId
    );
  }

  throw new Error(
    "ASC ThreadStore is not configured. Configure the durable ASC registry first."
  );
}

export async function bridgedThreadServicesForDomain(
  accountDomainId: string
) {
  const control = await controlRegistryServicesForDomain(accountDomainId);
  const store = threadStoreForDomain(accountDomainId);
  const bridge = new BridgedThreadService(store, control.projects);

  return {
    store,
    control,
    bridge,
    relay: new FounderRelayService({
      threadStore: store,
      identities: control.identities,
      continuation: control.continuation
    }),
    calibration: new RelayCalibrationService(store),
    autonomyReview: new OwnerAutonomyReviewService({
      calibration: new RelayCalibrationService(store),
      continuation: control.continuation
    })
  };
}

export async function bridgedThreadServices() {
  const control = await controlRegistryServices();
  const services = await bridgedThreadServicesForDomain(
    control.store.accountDomainId
  );
  return {
    ...services,
    control: {
      ...services.control,
      principalId: control.principalId
    }
  };
}

function latestCheckpoint(snapshot: ThreadSnapshot) {
  return [...snapshot.checkpoints]
    .sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt)
    )[0];
}

function latestRelay(snapshot: ThreadSnapshot) {
  return [...snapshot.relays]
    .sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt)
    )[0];
}

function numericEnv(
  name: string,
  fallback: number
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(name + " must be numeric.");
  }
  return value;
}

export function relayCalibrationPolicy() {
  return {
    minimumResponses: numericEnv(
      "ASC_RELAY_CALIBRATION_MIN_RESPONSES",
      20
    ),
    minimumAcceptanceRate: numericEnv(
      "ASC_RELAY_CALIBRATION_MIN_ACCEPTANCE_RATE",
      0.9
    ),
    maximumRejectionRate: numericEnv(
      "ASC_RELAY_CALIBRATION_MAX_REJECTION_RATE",
      0.05
    ),
    maximumMeanEditRatio: numericEnv(
      "ASC_RELAY_CALIBRATION_MAX_MEAN_EDIT_RATIO",
      0.25
    )
  };
}

export async function loadPulseView(now?: string) {
  if (!controlRegistryConfigured()) {
    return {
      configured: false as const,
      accountDomainId: defaultAccountDomainId(),
      threads: []
    };
  }

  const services = await bridgedThreadServices();
  const snapshots = await services.store.list();
  const pulses = await services.bridge.listPulse(now);
  const pulseMap = new Map(
    pulses.map((pulse) => [pulse.threadId, pulse])
  );

  return {
    configured: true as const,
    accountDomainId: services.store.accountDomainId,
    principalId: services.control.principalId,
    threads: await Promise.all(
      snapshots.map(async (snapshot) => {
        const checkpoint = latestCheckpoint(snapshot);
        const relay = latestRelay(snapshot);
        const calibration = relay
          ? await services.calibration.project({
              representedPrincipalId: relay.representedPrincipalId,
              projectId: relay.projectId,
              workClass: relay.workClass,
              policy: relayCalibrationPolicy()
            })
          : undefined;
        const currentAutonomyGrant = relay
          ? await services.control.continuation.getLatestAutonomyGrant(
              relay.projectId,
              relay.workClass
            )
          : undefined;
        const canGrantContinue =
          Boolean(
            relay &&
            calibration?.readiness === "review_candidate" &&
            services.control.principalId &&
            relay.representedPrincipalId === services.control.principalId &&
            !(
              currentAutonomyGrant &&
              currentAutonomyGrant.state === "active" &&
              currentAutonomyGrant.level >= 2
            )
          );

        return {
          thread: snapshot.thread,
          pulse: pulseMap.get(snapshot.thread.threadId)!,
          synopsis: checkpoint?.synopsis,
          gate: checkpoint?.gate,
          blocker: checkpoint?.blocker,
          lastSteering: checkpoint?.lastSteering,
          checkpointId: checkpoint?.checkpointId,
          relay,
          calibration,
          currentAutonomyGrant,
          canGrantContinue,
          canReviewRelay:
            Boolean(
              relay &&
              relay.state === "suggested" &&
              services.control.principalId &&
              relay.representedPrincipalId === services.control.principalId
            )
        };
      })
    )
  };
}
