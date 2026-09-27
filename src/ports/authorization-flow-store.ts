export type AuthorizationFlowState = "pending" | "consumed";

export interface AuthorizationFlow {
  readonly flowId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
  readonly provider: string;
  readonly stateHash: string;
  readonly callbackUrl: string;
  readonly providerFlowReference?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: AuthorizationFlowState;
  readonly consumedAt?: string;
}

export interface CreateAuthorizationFlowInput {
  readonly flow: AuthorizationFlow;
}

export interface ConsumeAuthorizationFlowInput {
  readonly flowId: string;
  readonly stateHash: string;
  readonly now: string;
}

export interface AuthorizationFlowStore {
  create(input: CreateAuthorizationFlowInput): Promise<void>;
  get(flowId: string): Promise<AuthorizationFlow | undefined>;
  consume(input: ConsumeAuthorizationFlowInput): Promise<AuthorizationFlow>;
}
