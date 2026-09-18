import type { DesiredStateClaim } from "./state.js";
import type { ProjectId, WorkspaceId } from "./shared.js";

export interface Workspace {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly selectedHost?: string;
  readonly objective?: string;
  readonly desiredStateOverlay?: readonly DesiredStateClaim[];
  readonly visiblePanels?: readonly string[];
}
