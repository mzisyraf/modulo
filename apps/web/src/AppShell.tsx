import type { ReactNode } from "react";

export type AppView = "workspace" | "tone-match" | "presets" | "recordings" | "settings";

const navigation: Array<{ view: AppView; label: string; icon: string }> = [
  { view: "workspace", label: "Workspace", icon: "⌂" },
  { view: "tone-match", label: "Tone Match", icon: "≈" },
  { view: "presets", label: "Presets", icon: "▣" },
  { view: "recordings", label: "Recordings", icon: "●" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const titles: Record<AppView, { title: string; description: string }> = {
  workspace: { title: "Workspace", description: "Your local Modulo session." },
  "tone-match": { title: "Tone Match", description: "Build and audition a fixture-labelled guitar setup." },
  presets: { title: "Presets", description: "Review the preset available in this browser session." },
  recordings: { title: "Recordings", description: "Processed-guitar recording is a later engine milestone." },
  settings: { title: "Settings", description: "Account and cloud preferences are not configured." },
};

interface AppShellProps {
  apiState: string;
  children: ReactNode;
  onNavigate: (view: AppView) => void;
  view: AppView;
}

export function AppShell({ apiState, children, onNavigate, view }: AppShellProps) {
  const current = titles[view];
  const apiConnected = apiState.startsWith("API connected");

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Primary navigation">
      <button className="brand" onClick={() => onNavigate("workspace")} aria-label="Modulo workspace">
        <span className="brand-mark" aria-hidden="true">≋</span><span>modulo</span>
      </button>
      <nav className="primary-nav" aria-label="Workspace">
        {navigation.map((item) => <button key={item.view} className={view === item.view ? "nav-item active" : "nav-item"} aria-current={view === item.view ? "page" : undefined} onClick={() => onNavigate(item.view)}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
          {(item.view === "recordings" || item.view === "settings") && <span className="nav-status">Later</span>}
        </button>)}
      </nav>
      <div className="sidebar-note">
        <strong>Development build</strong>
        <span>Fixtures stay labelled. No project data is stored.</span>
      </div>
    </aside>

    <div className="app-frame">
      <header className="topbar">
        <div><p className="breadcrumb">Workspace <span aria-hidden="true">/</span> {current.title}</p><h1>{current.title}</h1><p>{current.description}</p></div>
        <div className="topbar-status"><span className={apiConnected ? "status-dot connected" : "status-dot"} aria-hidden="true" />{apiState}</div>
      </header>
      <main className="app-content" id="main-content">{children}</main>
    </div>
  </div>;
}
