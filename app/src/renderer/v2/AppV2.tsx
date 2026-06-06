import "@/components/open-shell/tokens/codex-theme.css";
import "./styles/v2.css";

import { TerminalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell, BottomPanel, Sidebar } from "@/components/open-shell";

import { Dashboard } from "./components/Dashboard";
import { TerminalPanel, type TerminalPanelHandle } from "./components/TerminalPanel";
import { Workspace } from "./components/Workspace";
import {
  bootstrapProjects,
  openSavedProject
} from "./lib/projectStore";
import type { ProjectRecord, ProjectSummary } from "./types";

export default function AppV2() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
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
        setActiveProject(null);
        void refresh();
      }}
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
      sidebar={
        <Sidebar
          projects={sidebarProjects}
          items={[]}
          onProjectSelect={(projectId) => void openProject(projectId)}
        />
      }
      main={main}
      rightPanel={null}
      composer={<div className="v2-composer-slot">Project runtime only. No agent generation in v2 MVP.</div>}
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
