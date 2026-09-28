export interface ExternalRepositoryAttestation {
  readonly connectionReference: string;
  readonly repository: string;
  readonly accountReference: string;
  readonly accountDisplayName: string;
  readonly accountType: string;
  readonly capabilities: readonly string[];
  readonly verifiedAt: string;
}

export interface AttestExternalRepositoryInput {
  readonly connectionReference: string;
  readonly repository: string;
  readonly principalId: string;
  readonly accountDomainId: string;
}

export interface ExternalRepositoryAttestor {
  attestRepository(
    input: AttestExternalRepositoryInput
  ): Promise<ExternalRepositoryAttestation>;
}
