import type {
  ExternalProjectWorkItem,
  ProjectWorkItemSource
} from "../../ports/project-work-item-source.js";

export interface GitHubWorkItemSourceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly token?: string;
  readonly maxPages?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRepository(repository: string): {
  readonly owner: string;
  readonly name: string;
} {
  const pieces = repository.trim().split("/");
  if (
    pieces.length !== 2 ||
    !pieces[0] ||
    !pieces[1] ||
    !/^[A-Za-z0-9_.-]+$/u.test(pieces[0]) ||
    !/^[A-Za-z0-9_.-]+$/u.test(pieces[1])
  ) {
    throw new Error("GitHub work-item repository must be owner/repository.");
  }
  return Object.freeze({ owner: pieces[0], name: pieces[1] });
}

function labels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      result.push(item.trim());
    } else if (
      record(item) &&
      typeof item.name === "string" &&
      item.name.trim()
    ) {
      result.push(item.name.trim());
    }
  }
  return Object.freeze(result);
}

function parseIssue(value: unknown): ExternalProjectWorkItem | null {
  if (!record(value) || Object.prototype.hasOwnProperty.call(value, "pull_request")) {
    return null;
  }
  if (
    typeof value.number !== "number" ||
    !Number.isInteger(value.number) ||
    value.number < 1 ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.html_url !== "string" ||
    !value.html_url.trim()
  ) {
    return null;
  }

  return Object.freeze({
    number: value.number,
    title: value.title.trim(),
    url: value.html_url.trim(),
    labels: labels(value.labels)
  });
}

export class GitHubWorkItemSource implements ProjectWorkItemSource {
  readonly #fetch: typeof fetch;
  readonly #token: string | undefined;
  readonly #maxPages: number;

  constructor(options: GitHubWorkItemSourceOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    const token = options.token?.trim();
    this.#token = token || undefined;
    const maxPages = options.maxPages ?? 5;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) {
      throw new Error("GitHub work-item maxPages must be between 1 and 20.");
    }
    this.#maxPages = maxPages;
  }

  async listOpen(repository: string): Promise<readonly ExternalProjectWorkItem[]> {
    const { owner, name } = safeRepository(repository);
    const result: ExternalProjectWorkItem[] = [];

    for (let page = 1; page <= this.#maxPages; page += 1) {
      const url = new URL(
        "https://api.github.com/repos/" +
          encodeURIComponent(owner) +
          "/" +
          encodeURIComponent(name) +
          "/issues"
      );
      url.searchParams.set("state", "open");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const headers = new Headers({
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28"
      });
      if (this.#token) headers.set("authorization", "Bearer " + this.#token);

      const response = await this.#fetch(url, { headers });
      if (!response.ok) {
        throw new Error(
          "GitHub work visibility unavailable (" + response.status + ")."
        );
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("GitHub work visibility returned an invalid issue list.");
      }

      for (const value of payload) {
        const parsed = parseIssue(value);
        if (parsed) result.push(parsed);
      }

      if (payload.length < 100) return Object.freeze(result);
    }

    throw new Error(
      "GitHub work visibility exceeded the bounded pagination window."
    );
  }
}
