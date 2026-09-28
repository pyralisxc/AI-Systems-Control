import type {
  ExternalProjectWorkItem,
  ProjectWorkItemSource
} from "../ports/project-work-item-source.js";

export interface ProjectWorkItemProjectionItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly labels: readonly string[];
  readonly productionBlocking: boolean;
  readonly status?: string;
  readonly severity?: string;
  readonly priority?: string;
}

export interface ProjectWorkItemCounts {
  readonly active: number;
  readonly productionBlockers: number;
  readonly critical: number;
  readonly high: number;
  readonly normal: number;
}

export interface ProjectWorkItemProjection {
  readonly repository: string;
  readonly available: boolean;
  readonly observedAt: string;
  readonly counts: ProjectWorkItemCounts;
  readonly items: readonly ProjectWorkItemProjectionItem[];
  readonly reason?: string;
}

function labelValue(
  labels: readonly string[],
  prefix: string
): string | undefined {
  const normalizedPrefix = prefix.toLowerCase() + ":";
  for (const label of labels) {
    const normalized = label.trim().toLowerCase();
    if (normalized.startsWith(normalizedPrefix)) {
      const value = label.trim().slice(normalizedPrefix.length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

function hasLabel(labels: readonly string[], expected: string): boolean {
  const normalized = expected.toLowerCase();
  return labels.some((label) => label.trim().toLowerCase() === normalized);
}

function projectItem(
  item: ExternalProjectWorkItem
): ProjectWorkItemProjectionItem {
  const status = labelValue(item.labels, "status");
  const severity = labelValue(item.labels, "severity");
  const priority = labelValue(item.labels, "priority");

  return Object.freeze({
    number: item.number,
    title: item.title,
    url: item.url,
    labels: Object.freeze([...item.labels]),
    productionBlocking: hasLabel(item.labels, "production-blocking"),
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(priority ? { priority } : {})
  });
}

function emptyCounts(): ProjectWorkItemCounts {
  return Object.freeze({
    active: 0,
    productionBlockers: 0,
    critical: 0,
    high: 0,
    normal: 0
  });
}

export function projectWorkItemProjection(
  repository: string,
  sourceItems: readonly ExternalProjectWorkItem[],
  observedAt: string = new Date().toISOString()
): ProjectWorkItemProjection {
  const items = sourceItems.map(projectItem);
  const critical = items.filter(
    (item) => item.severity?.toLowerCase() === "critical"
  ).length;
  const high = items.filter(
    (item) => item.severity?.toLowerCase() === "high"
  ).length;

  return Object.freeze({
    repository,
    available: true,
    observedAt,
    counts: Object.freeze({
      active: items.length,
      productionBlockers: items.filter((item) => item.productionBlocking).length,
      critical,
      high,
      normal: items.length - critical - high
    }),
    items: Object.freeze(items)
  });
}

export class ProjectWorkItemProjectionService {
  readonly #source: ProjectWorkItemSource;

  constructor(source: ProjectWorkItemSource) {
    this.#source = source;
  }

  async load(
    repository: string,
    observedAt: string = new Date().toISOString()
  ): Promise<ProjectWorkItemProjection> {
    try {
      const items = await this.#source.listOpen(repository);
      return projectWorkItemProjection(repository, items, observedAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return Object.freeze({
        repository,
        available: false,
        observedAt,
        counts: emptyCounts(),
        items: Object.freeze([]),
        reason
      });
    }
  }
}
