import {
  JsonFileThreadStore,
  PostgresThreadStore
} from "../../../dist/adapters/index.js";
import {
  BridgedThreadService,
  FounderRelayService
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
  defaultAccountDomainId
} from "./control-registry";

let cachedDatabaseUrl: string | undefined;
let cachedAccountDomainId: string | undefined;
let cachedPostgresThreadStore: PostgresThreadStore | undefined;

function threadStore(): ThreadStore {
  const accountDomainId = defaultAccountDomainId();
  const databaseUrl = controlRegistryDatabaseUrl();

  if (databaseUrl) {
    if (
      !cachedPostgresThreadStore ||
      cachedDatabaseUrl !== databaseUrl ||
      cachedAccountDomainId !== accountDomainId
    ) {
      cachedPostgresThreadStore = PostgresThreadStore.fromConnectionString(
        databaseUrl,
        accountDomainId
      );
      cachedDatabaseUrl = databaseUrl;
      cachedAccountDomainId = accountDomainId;
    }
    return cachedPostgresThreadStore;
  }

  const path = controlRegistryPath();
  if (path) {
    return new JsonFileThreadStore(path + ".threads", accountDomainId);
  }

  throw new Error(
    "ASC ThreadStore is not configured. Configure the durable ASC registry first."
  );
}

export async function bridgedThreadServices() {
  const control = await controlRegistryServices();
  const store = threadStore();
  const bridge = new BridgedThreadService(store, control.projects);
  return {
    store,
    control,
    bridge,
    relay: new FounderRelayService({
      threadStore: store,
      identities: control.identities,
      continuation: control.continuation
    })
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
    threads: snapshots.map((snapshot) => {
      const checkpoint = latestCheckpoint(snapshot);
      const relay = latestRelay(snapshot);
      return {
        thread: snapshot.thread,
        pulse: pulseMap.get(snapshot.thread.threadId)!,
        synopsis: checkpoint?.synopsis,
        gate: checkpoint?.gate,
        blocker: checkpoint?.blocker,
        lastSteering: checkpoint?.lastSteering,
        checkpointId: checkpoint?.checkpointId,
        relay,
        canReviewRelay:
          Boolean(
            relay &&
            relay.state === "suggested" &&
            services.control.principalId &&
            relay.representedPrincipalId === services.control.principalId
          )
      };
    })
  };
}
