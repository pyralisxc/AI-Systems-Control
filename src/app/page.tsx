import { redirect } from "next/navigation";
import {
  normalizeOwnerReturnPath
} from "../../dist/application/index.js";
import { ProjectWorkspace } from "@/features/project-workspace/ProjectWorkspace";
import { isOwnerAuthenticated } from "@/web/auth/owner-auth";
import {
  defaultRepository,
  loadProjectWorkspace
} from "@/web/runtime/project-workspace";

export const dynamic = "force-dynamic";

interface HomePageProps {
  readonly searchParams: Promise<{
    readonly repository?: string | readonly string[];
  }>;
}

function scalar(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const repository = scalar(params.repository)?.trim() || defaultRepository();
  const returnPath = normalizeOwnerReturnPath(
    `/?repository=${encodeURIComponent(repository)}`
  );

  if (!(await isOwnerAuthenticated())) {
    redirect(`/login?returnTo=${encodeURIComponent(returnPath)}`);
  }

  try {
    const view = await loadProjectWorkspace(repository);
    return <ProjectWorkspace view={view} repository={repository} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <main className="fatal-shell">
        <div className="fatal-card">
          <span className="eyebrow">Project could not be opened</span>
          <h1>AI Systems Control</h1>
          <p>{message}</p>
          <form className="project-picker" method="get">
            <label htmlFor="repository">GitHub repository</label>
            <div className="project-picker__row">
              <input
                id="repository"
                name="repository"
                defaultValue={repository}
                placeholder="owner/repository"
                spellCheck={false}
              />
              <button type="submit">Try again</button>
            </div>
          </form>
        </div>
      </main>
    );
  }
}
