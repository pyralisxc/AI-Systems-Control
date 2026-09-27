import {
  JsonFileThreadStore,
  PostgresThreadStore
} from "../../../dist/adapters/index.js";
import {
  BridgedThreadService
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
  return {
    store,
    bridge: new BridgedThreadService(store, control.projects)
  };
}

function latestCheckpoint(snapshot: ThreadSnapshot) {
  return [...snapshot.checkpoints]
    .sort((left, right) =>
      right.publishedAt.localeCompare(left.publishedAt)
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
    threads: snapshots.map((snapshot) => {
      const checkpoint = latestCheckpoint(snapshot);
      return {
        thread: snapshot.thread,
        pulse: pulseMap.get(snapshot.thread.threadId)!,
        synopsis: checkpoint?.synopsis,
        gate: checkpoint?.gate,
        blocker: checkpoint?.blocker,
        lastSteering: checkpoint?.lastSteering,
        checkpointId: checkpoint?.checkpointId
      };
    })
  };
}
