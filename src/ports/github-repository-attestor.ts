export interface GitHubRepositoryAttestation {
  readonly installationId: string;
  readonly repository: string;
  readonly accountId: string;
  readonly accountLogin: string;
  readonly accountType: "User" | "Organization" | "Enterprise";
  readonly capabilities: readonly string[];
  readonly verifiedAt: string;
}

export interface AttestGitHubRepositoryInput {
  readonly installationId: string;
  readonly repository: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface GitHubRepositoryAttestor {
  attestRepository(
    input: AttestGitHubRepositoryInput
  ): Promise<GitHubRepositoryAttestation>;
}
