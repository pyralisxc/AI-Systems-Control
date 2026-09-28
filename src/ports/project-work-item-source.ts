export interface ExternalProjectWorkItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly labels: readonly string[];
}

export interface ProjectWorkItemSource {
  listOpen(repository: string): Promise<readonly ExternalProjectWorkItem[]>;
}
