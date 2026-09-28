export interface GitHubInstallationAttestation {
  readonly installationId: string;
  readonly accountId: string;
  readonly accountLogin: string;
  readonly accountType: "User" | "Organization" | "Enterprise";
  readonly repositorySelection: "all" | "selected";
  readonly capabilities: readonly string[];
  readonly verifiedAt: string;
}

export interface AttestGitHubInstallationInput {
  readonly installationId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface VerifyGitHubInstallationInput {
  readonly installationId: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface GitHubInstallationAttestor {
  attestInstallation(
    input: AttestGitHubInstallationInput
  ): Promise<GitHubInstallationAttestation>;

  verifyInstallation(
    input: VerifyGitHubInstallationInput
  ): Promise<GitHubInstallationAttestation | undefined>;
}
