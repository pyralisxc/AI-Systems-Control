import {
  ProjectWorkItemProjectionService,
  type ProjectWorkItemProjection
} from "../../../dist/application/index.js";
import {
  GitHubWorkItemSource
} from "../../../dist/adapters/index.js";

export async function loadProjectWorkItems(
  repository: string
): Promise<ProjectWorkItemProjection> {
  // Public repositories work without a credential. Private/provider-scoped
  // reads should later supply a bounded ASC Connection delegation rather than
  // introduce a second long-lived credential path here.
  const source = new GitHubWorkItemSource();
  return await new ProjectWorkItemProjectionService(source).load(repository);
}
