import { useState, type ReactNode } from "react";

export type AppView = "workspace" | "tone-match" | "presets" | "recordings" | "settings";

const navigation: Array<{ view: AppView; label: string; icon: string }> = [
  { view: "workspace", label: "Workspace", icon: "⌂" },
  { view: "tone-match", label: "Tone Match", icon: "≈" },
  { view: "presets", label: "Presets", icon: "▣" },
  { view: "recordings", label: "Recordings", icon: "●" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const titles: Record<AppView, { title: string; description: string }> = {
  workspace: { title: "Workspace", description: "Pick up where you left off." },
  "tone-match": { title: "Tone Match", description: "Build, hear and shape your guitar tone." },
  presets: { title: "Presets", description: "Your tones, ready when you are." },
  recordings: { title: "Recordings", description: "Capture and revisit your performances." },
  settings: { title: "Settings", description: "Your Modulo preferences." },
};

interface AppShellProps {
  apiState: string;
  children: ReactNode;
  onNavigate: (view: AppView) => void;
  view: AppView;
}

export function AppShell({ apiState, children, onNavigate, view }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const current = titles[view];
  const apiConnected = apiState.startsWith("API connected");

  return <div className={collapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-header">
        <button className="brand" onClick={() => onNavigate("workspace")} aria-label="Modulo workspace">
          <span className="brand-mark" aria-hidden="true">≋</span><span>modulo</span>
        </button>
        <button className="collapse-button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setCollapsed((currentValue) => !currentValue)}>
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
      </div>
      <nav className="primary-nav" aria-label="Workspace">
        {navigation.map((item) => <button key={item.view} className={view === item.view ? "nav-item active" : "nav-item"} aria-label={item.label} aria-current={view === item.view ? "page" : undefined} onClick={() => onNavigate(item.view)}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
          {item.view === "settings" && <span className="nav-status">Later</span>}
        </button>)}
      </nav>
      <p className="sidebar-signoff">Make some noise.</p>
    </aside>

    <div className="app-frame">
      <header className="topbar">
        <div><p className="breadcrumb">Workspace <span aria-hidden="true">/</span> {current.title}</p><h1>{current.title}</h1><p>{current.description}</p></div>
        <div className="topbar-status" title={apiState}><span className={apiConnected ? "status-dot connected" : "status-dot"} aria-hidden="true" />Local workflow</div>
      </header>
      <main className="app-content" id="main-content">{children}</main>
    </div>
  </div>;
}
