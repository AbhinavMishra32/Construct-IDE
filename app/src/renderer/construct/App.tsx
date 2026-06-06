import "@/components/open-shell/tokens/codex-theme.css";
import "./styles/construct.css";

import { PanelBottomIcon, PanelLeftIcon, PanelRightIcon, TerminalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AppShell,
  AppShellCollapsedSidebarTrigger,
  AppShellHeaderToolButton,
  BottomPanel,
  Composer,
  Sidebar
} from "@/components/open-shell";

import { Dashboard } from "./components/Dashboard";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import type { ProjectRecord, ProjectSummary } from "./types";

export default function ConstructApp() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [rightPanel, setRightPanel] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<TerminalPanelHandle | null>(null);

  useEffect(() => {
    document.documentElement.dataset.codexWindowType = "electron";
    document.documentElement.dataset.codexOs = window.construct.getRuntimeInfo().platform;
    void refresh();
  }, []);

  async function refresh() {
    try {
      setBusy(true);
      setError(null);
      setProjects(await bootstrapProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string) {
    try {
      setBusy(true);
      setError(null);
      setActiveProject(await openSavedProject(projectId));
      setProjects(await bootstrapProjects());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const sidebarProjects = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: project.title,
        active: activeProject?.id === project.id,
        threads: [
          {
            id: `${project.id}:progress`,
            title: `${project.progress}% complete`,
            meta: "project"
          }
        ]
      })),
    [activeProject?.id, projects]
  );

  const main = activeProject ? (
      <Workspace
        project={activeProject}
        onBack={() => {
          setRightPanel(null);
          setActiveProject(null);
          void refresh();
        }}
        onGuidePanelChange={setRightPanel}
        onProjectChange={setActiveProject}
        onRunCommand={(command, cwd) => terminalRef.current?.runCommand(command, cwd)}
    />
  ) : (
    <Dashboard
      projects={projects}
      busy={busy}
      error={error}
      onRefresh={() => void refresh()}
      onOpenProject={(projectId) => void openProject(projectId)}
    />
  );

  return (
    <AppShell
      headerTabs={[
        {
          id: activeProject?.id ?? "dashboard",
          title: activeProject?.title ?? "Projects",
          active: true
        }
      ]}
      collapsedSidebarTrigger={(state) => (
        <AppShellCollapsedSidebarTrigger onClick={state.toggleSidebar} aria-label="Open sidebar">
          <PanelLeftIcon size={15} />
        </AppShellCollapsedSidebarTrigger>
      )}
      headerActions={(state) => (
        <>
          <AppShellHeaderToolButton onClick={state.toggleSidebar} aria-label="Toggle sidebar">
            <PanelLeftIcon size={15} />
          </AppShellHeaderToolButton>
          {activeProject ? (
            <>
              <AppShellHeaderToolButton onClick={state.toggleRightPanel} aria-label="Toggle guide panel">
                <PanelRightIcon size={15} />
              </AppShellHeaderToolButton>
              <AppShellHeaderToolButton onClick={state.toggleBottomPanel} aria-label="Toggle terminal">
                <PanelBottomIcon size={15} />
              </AppShellHeaderToolButton>
            </>
          ) : null}
        </>
      )}
      sidebar={
        <Sidebar
          projects={sidebarProjects}
          items={[]}
          onProjectSelect={(projectId) => void openProject(projectId)}
        />
      }
      main={main}
      rightPanel={activeProject ? rightPanel : null}
      composer={
        <Composer
          placeholder="Construct is project-runtime only. Follow the guide, type code, and run commands below."
          readOnly
          value=""
          footerLeading={<div className="construct-composer-status">Linear .construct tape runtime</div>}
          footerTrailing={<div className="construct-composer-status">No agent generation in this MVP</div>}
        />
      }
      bottomPanel={
        activeProject ? (
          <BottomPanel
            tabs={[
              {
                id: "terminal",
                title: "Terminal",
                active: true,
                icon: <TerminalIcon size={14} />,
                content: (
                  <TerminalPanel
                    ref={terminalRef}
                    projectId={activeProject.id}
                    cwd={activeProject.workspacePath}
                  />
                )
              }
            ]}
          />
        ) : null
      }
    />
  );
}
