import { createHash } from "node:crypto";

import {
  GitHubInstallationAuthorizationProvider,
  JsonFileAuthorizationFlowStore,
  PostgresAuthorizationFlowStore,
  RemoteGitHubInstallationAttestor
} from "../../../dist/adapters/index.js";
import {
  ConnectionAuthorizationBroker,
  flowIdFromAuthorizationState,
  GitHubProjectAuthorizationService
} from "../../../dist/application/index.js";
import type {
  AuthorizationFlowStore
} from "../../../dist/ports/index.js";
import {
  controlRegistryDatabaseUrl,
  controlRegistryPath,
  controlRegistryServices,
  defaultAccountDomainId
} from "./control-registry";

const postgresFlowStores =
  new Map<string, PostgresAuthorizationFlowStore>();

function localSuffix(accountDomainId: string): string {
  return createHash("sha256")
    .update(accountDomainId)
    .digest("hex")
    .slice(0, 20);
}

function bridgeConfiguration():
  | {
      readonly baseUrl: string;
      readonly secret: string;
    }
  | undefined {
  const baseUrl =
    process.env.ASC_CONDUCTOR_PROVIDER_BRIDGE_URL?.trim();
  const secret =
    process.env.ASC_CONDUCTOR_PROVIDER_BRIDGE_SECRET?.trim();

  if (!baseUrl && !secret) return undefined;
  if (!baseUrl || !secret) {
    throw new Error(
      "ASC_CONDUCTOR_PROVIDER_BRIDGE_URL and ASC_CONDUCTOR_PROVIDER_BRIDGE_SECRET must be configured together."
    );
  }

  return Object.freeze({ baseUrl, secret });
}

function callbackUrl(): string {
  const explicit =
    process.env.ASC_GITHUB_SETUP_CALLBACK_URL?.trim();
  if (explicit) return explicit;

  const branchUrl =
    process.env.VERCEL_BRANCH_URL?.trim();
  if (!branchUrl) {
    throw new Error(
      "GitHub setup callback requires ASC_GITHUB_SETUP_CALLBACK_URL or VERCEL_BRANCH_URL."
    );
  }

  const origin = branchUrl.includes("://")
    ? new URL(branchUrl)
    : new URL("https://" + branchUrl);

  return new URL(
    "/api/connections/github/callback",
    origin
  ).toString();
}

function authorizationFlowStore(
  accountDomainId: string
): AuthorizationFlowStore {
  const databaseUrl = controlRegistryDatabaseUrl();
  if (databaseUrl) {
    const key =
      databaseUrl + "\u0000" + accountDomainId;
    const cached = postgresFlowStores.get(key);
    if (cached) return cached;

    const store =
      PostgresAuthorizationFlowStore.fromConnectionString(
        databaseUrl,
        accountDomainId
      );
    postgresFlowStores.set(key, store);
    return store;
  }

  const path = controlRegistryPath();
  if (path) {
    const suffix =
      accountDomainId === defaultAccountDomainId()
        ? ""
        : ".domain-" + localSuffix(accountDomainId);

    return new JsonFileAuthorizationFlowStore(
      path + ".auth-flows" + suffix,
      accountDomainId
    );
  }

  throw new Error(
    "Durable ASC storage is required for provider authorization."
  );
}

export function githubConnectionConfigured(): boolean {
  try {
    return Boolean(bridgeConfiguration());
  } catch {
    return false;
  }
}

export async function githubConnectionServices() {
  const bridge = bridgeConfiguration();
  if (!bridge) {
    throw new Error(
      "GitHub Connection bridge is not configured."
    );
  }

  const control = await controlRegistryServices();
  if (!control.principalId) {
    throw new Error(
      "GitHub Connection requires current Principal context."
    );
  }

  const attestor =
    new RemoteGitHubInstallationAttestor({
      baseUrl: bridge.baseUrl,
      secret: bridge.secret
    });
  const app = await attestor.getAppIdentity();
  const setupCallbackUrl = callbackUrl();

  return {
    control,
    app,
    attestor,
    setupCallbackUrl,
    broker: new ConnectionAuthorizationBroker({
      flowStore: authorizationFlowStore(
        control.store.accountDomainId
      ),
      connections: control.connections,
      providers: [
        new GitHubInstallationAuthorizationProvider({
          appSlug: app.appSlug,
          setupCallbackUrl,
          attestor
        })
      ]
    })
  };
}

export async function beginGitHubConnection() {
  const services = await githubConnectionServices();

  return services.broker.begin({
    principalId: services.control.principalId!,
    accountDomainId:
      services.control.store.accountDomainId,
    provider: "github",
    callbackUrl: services.setupCallbackUrl
  });
}

export async function completeGitHubConnection(
  state: string,
  callback: Readonly<Record<string, string>>
) {
  const services = await githubConnectionServices();
  const flowId =
    flowIdFromAuthorizationState(state);

  return services.broker.complete({
    flowId,
    state,
    callback
  });
}


export async function bindGitHubConnectionToProject(input: {
  readonly projectId: string;
  readonly connectionId: string;
  readonly executionCapability: string;
}) {
  const services = await githubConnectionServices();
  const authorization =
    new GitHubProjectAuthorizationService({
      projects: services.control.projects,
      connections: services.control.connections,
      bindings: services.control.bindings,
      delegations: services.control.delegations,
      repositoryAttestor: services.attestor
    });

  return authorization.bindProject({
    principalId: services.control.principalId!,
    projectId: input.projectId,
    connectionId: input.connectionId,
    executionCapability:
      input.executionCapability
  });
}

export async function issueGitHubDevelopmentIntelligenceDelegations(
  projectId: string
) {
  const services = await githubConnectionServices();
  const authorization =
    new GitHubProjectAuthorizationService({
      projects: services.control.projects,
      connections: services.control.connections,
      bindings: services.control.bindings,
      delegations: services.control.delegations,
      repositoryAttestor: services.attestor
    });

  return authorization.issueDevelopmentIntelligenceDelegations({
    principalId: services.control.principalId!,
    projectId
  });
}

export async function issueGitHubConductorDelegation(input: {
  readonly projectId: string;
  readonly capabilityId: string;
  readonly approvalReference: string;
}) {
  const services = await githubConnectionServices();
  const authorization =
    new GitHubProjectAuthorizationService({
      projects: services.control.projects,
      connections: services.control.connections,
      bindings: services.control.bindings,
      delegations: services.control.delegations,
      repositoryAttestor: services.attestor
    });

  return authorization.issueConductorDelegation({
    principalId: services.control.principalId!,
    projectId: input.projectId,
    capabilityId: input.capabilityId,
    approvalReference: input.approvalReference
  });
}
