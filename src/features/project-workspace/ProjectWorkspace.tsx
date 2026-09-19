import type {
  OwnerCapabilityItem,
  OwnerDesiredItem,
  OwnerProjectRealityView,
  OwnerRealityItem
} from "@/slice-a/index";

interface ProjectWorkspaceProps {
  readonly view: OwnerProjectRealityView;
  readonly repository: string;
}

function displayValue(value: unknown): string {
  if (value === undefined) return "Unknown";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function freshnessLabel(item: OwnerRealityItem): string {
  return item.freshness.state;
}

function availabilityTone(
  state: string
): "positive" | "warning" | "critical" | "neutral" {
  if (state === "available" || state === "aligned" || state === "fresh") {
    return "positive";
  }
  if (
    state === "partial" ||
    state === "aging" ||
    state === "permission_blocked" ||
    state === "ambiguous" ||
    state === "stale"
  ) {
    return "warning";
  }
  if (state === "unavailable" || state === "divergent") {
    return "critical";
  }
  return "neutral";
}

function Pill({ value }: { readonly value: string }) {
  return (
    <span className="status-pill" data-tone={availabilityTone(value)}>
      <span className="status-dot" aria-hidden="true" />
      {value.replaceAll("_", " ")}
    </span>
  );
}

function RealityRow({ item }: { readonly item: OwnerRealityItem }) {
  const identity = `${item.observation.subject}.${item.observation.property}`;
  return (
    <article className="reality-row">
      <div className="reality-row__heading">
        <div>
          <span className="eyebrow">{item.truthCategory}</span>
          <h3>{identity}</h3>
        </div>
        <Pill value={freshnessLabel(item)} />
      </div>
      <pre className="reality-value">{displayValue(item.observation.value)}</pre>
      {item.observation.unknownReason ? (
        <p className="inline-problem">{item.observation.unknownReason}</p>
      ) : null}
      <div className="meta-line">
        <span>{item.observation.producingSystem}</span>
        <span>{new Date(item.observation.observedAt).toLocaleString()}</span>
        <span>{item.observation.quality}</span>
      </div>
      <div className="evidence-line">
        {item.observation.evidence.map((evidence) => (
          <span
            className="evidence-chip"
            key={`${evidence.kind}:${evidence.locator}`}
            title={evidence.locator}
          >
            {evidence.kind}
          </span>
        ))}
      </div>
    </article>
  );
}

function DesiredRow({ item }: { readonly item: OwnerDesiredItem }) {
  return (
    <article className="reality-row">
      <div className="reality-row__heading">
        <div>
          <span className="eyebrow">desired</span>
          <h3>{item.desired.scope}.{item.desired.key}</h3>
        </div>
        <Pill value={item.drift.state} />
      </div>
      <pre className="reality-value">{displayValue(item.desired.value)}</pre>
      <div className="meta-line">
        <span>authority: {item.desired.authority}</span>
        <span>{new Date(item.desired.effectiveAt).toLocaleString()}</span>
      </div>
      {item.drift.reason ? (
        <p className="inline-problem">{item.drift.reason}</p>
      ) : null}
    </article>
  );
}

function CapabilityRow({ item }: { readonly item: OwnerCapabilityItem }) {
  return (
    <article className="capability-row">
      <div>
        <span className="eyebrow">{item.capability.ownerSystem}</span>
        <h3>{item.capability.name}</h3>
        <code>{item.capability.capabilityId}</code>
      </div>
      <div className="binding-stack">
        {item.bindings.map((binding) => (
          <div className="binding" key={binding.bindingId}>
            <Pill value={binding.availabilityState} />
            <span>{binding.host}</span>
            {binding.reason ? <small>{binding.reason}</small> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyState({ children }: { readonly children: string }) {
  return <div className="empty-state">{children}</div>;
}

export function ProjectWorkspace({
  view,
  repository
}: ProjectWorkspaceProps) {
  const availableCapabilities = view.capabilities.filter((item) =>
    item.bindings.some((binding) => binding.availabilityState === "available")
  ).length;
  const observationCount =
    view.truth.observed.length + view.truth.inferred.length;

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">ASC</div>
          <div>
            <strong>AI Systems Control</strong>
            <span>Owner console</span>
          </div>
        </div>

        <nav className="workspace-nav" aria-label="Workspace">
          <a className="nav-item nav-item--active" href="#overview">
            <span>01</span>
            Overview
          </a>
          <a className="nav-item" href="#intelligence">
            <span>02</span>
            Intelligence
          </a>
          <a className="nav-item" href="#desired">
            <span>03</span>
            Desired state
          </a>
          <a className="nav-item" href="#capabilities">
            <span>04</span>
            Capabilities
          </a>
          <span className="nav-item nav-item--future">
            <span>05</span>
            Actions
            <small>future slice</small>
          </span>
        </nav>

        <div className="sidebar-footer">
          <span>Selected host</span>
          <strong>Development Intelligence</strong>
          <Pill value={view.realityAvailability} />
        </div>
      </aside>

      <main className="workspace-main">
        <header className="topbar">
          <form className="project-picker" method="get">
            <label htmlFor="repository">Project</label>
            <div className="project-picker__row">
              <input
                id="repository"
                name="repository"
                defaultValue={repository}
                aria-label="GitHub repository"
                spellCheck={false}
              />
              <button type="submit">Open</button>
            </div>
          </form>
          <div className="topbar-status">
            <span className="eyebrow">Workspace</span>
            <code>{view.workspaceId}</code>
          </div>
        </header>

        <section className="hero" id="overview">
          <div>
            <span className="eyebrow">Project reality</span>
            <h1>{view.project.name}</h1>
            <p>
              One owner view over observed reality, inferred intelligence,
              declared intent, and the capabilities currently reachable for
              this project.
            </p>
            <div className="hero-meta">
              <span>{view.project.githubRepository ?? "No GitHub reference"}</span>
              <Pill value={view.realityAvailability} />
            </div>
          </div>
          <div className="hero-orbit" aria-hidden="true">
            <div className="orbit-ring orbit-ring--outer" />
            <div className="orbit-ring orbit-ring--inner" />
            <div className="orbit-core">ASC</div>
          </div>
        </section>

        <section className="metric-grid" aria-label="Project reality summary">
          <article className="metric-card">
            <span>Observed signals</span>
            <strong>{observationCount}</strong>
            <small>{view.truth.observed.length} direct · {view.truth.inferred.length} inferred</small>
          </article>
          <article className="metric-card">
            <span>Desired claims</span>
            <strong>{view.truth.desired.length}</strong>
            <small>operator-owned intent overlays</small>
          </article>
          <article className="metric-card">
            <span>Capabilities ready</span>
            <strong>{availableCapabilities}/{view.capabilities.length}</strong>
            <small>read-only in Slice A</small>
          </article>
          <article className="metric-card">
            <span>Reality problems</span>
            <strong>{view.problems.length}</strong>
            <small>uncertainty stays visible</small>
          </article>
        </section>

        {view.problems.length > 0 ? (
          <section className="problem-panel" aria-labelledby="problems-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Attention</span>
                <h2 id="problems-heading">Reality boundary</h2>
              </div>
            </div>
            <div className="problem-list">
              {view.problems.map((problem) => (
                <article key={problem.code}>
                  <code>{problem.code}</code>
                  <p>{problem.message}</p>
                  <span>{problem.retryable ? "retryable" : "configuration / evidence boundary"}</span>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="content-section" id="intelligence">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Observed</span>
              <h2>Project intelligence</h2>
              <p>Facts remain attached to freshness and evidence instead of collapsing into one health score.</p>
            </div>
            <span className="section-count">{view.truth.observed.length}</span>
          </div>
          <div className="reality-grid">
            {view.truth.observed.length > 0 ? (
              view.truth.observed.map((item) => (
                <RealityRow
                  item={item}
                  key={`${item.observation.subject}:${item.observation.property}`}
                />
              ))
            ) : (
              <EmptyState>No direct observations are available for this project.</EmptyState>
            )}
          </div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Inferred</span>
              <h2>Derived understanding</h2>
              <p>Interpretation from specialist systems stays visibly distinct from directly observed facts.</p>
            </div>
            <span className="section-count">{view.truth.inferred.length}</span>
          </div>
          <div className="reality-grid">
            {view.truth.inferred.length > 0 ? (
              view.truth.inferred.map((item) => (
                <RealityRow
                  item={item}
                  key={`${item.observation.subject}:${item.observation.property}`}
                />
              ))
            ) : (
              <EmptyState>No inferred observations are available yet.</EmptyState>
            )}
          </div>
        </section>

        <section className="content-section" id="desired">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Desired</span>
              <h2>Intent and drift</h2>
              <p>Desired state is compared with evidence; it is never presented as current reality.</p>
            </div>
            <span className="section-count">{view.truth.desired.length}</span>
          </div>
          <div className="reality-grid">
            {view.truth.desired.length > 0 ? (
              view.truth.desired.map((item) => (
                <DesiredRow
                  item={item}
                  key={`${item.desired.scope}:${item.desired.key}:${item.desired.authority}`}
                />
              ))
            ) : (
              <EmptyState>No owner desired-state overlays are configured for this workspace.</EmptyState>
            )}
          </div>
        </section>

        <section className="content-section" id="capabilities">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Bindings</span>
              <h2>Capability realization</h2>
              <p>Availability is resolved against the selected host and current permission state on every view.</p>
            </div>
            <span className="section-count">{view.capabilities.length}</span>
          </div>
          <div className="capability-list">
            {view.capabilities.map((item) => (
              <CapabilityRow item={item} key={item.capability.capabilityId} />
            ))}
          </div>
        </section>

        <footer className="workspace-footer">
          <span>Slice A · read-only project reality</span>
          <span>Mutations remain unreachable from this surface.</span>
        </footer>
      </main>
    </div>
  );
}
