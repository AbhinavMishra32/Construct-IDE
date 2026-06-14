import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
import { Folder, GearSix, Notebook, TerminalWindow, Trash } from "@phosphor-icons/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ShadcnDialog,
  ShadcnDialogContent,
  ShadcnDialogDescription,
  ShadcnDialogFooter,
  ShadcnDialogHeader,
  ShadcnDialogTitle,
  Input,
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@opaline/ui";
import type { SettingsNavSection } from "@opaline/ui";

import { ConstructAiSettingsSection } from "./components/settings/ConstructAiSettingsSection";
import { ConstructLspSettingsPanel } from "./components/settings/ConstructLspSettingsPanel";
import {
  aggregateLspStatus,
  createEmptyLspStatusReport,
  lspLanguageOrder,
  type LspStatusReport
} from "./components/settings/lspSettingsModel";
import { lspClient } from "./lib/lspClient";
import { restartProjectLsp } from "./lib/lspRuntime";
import { logStore, type LogChannel, type LogEntry } from "./lib/logStore";
import {
  deleteProject,
  getSettings,
  listAiFeatures,
  listModels,
  onAgentLog,
  selectWorkspaceDirectory,
  setThemeSource,
  setWorkspaceRoot,
  updateAiSettings,
  updateProject
} from "./lib/bridge";
import type {
  AiFeatureSettings,
  AiSettings,
  DeleteProjectCheck,
  ModelCatalogEntry,
  ProjectRecord,
  ProjectSummary
} from "./types";
import type { ThemeMode } from "./theme";

const defaultAiSettings: AiSettings = {
  runtime: "mastra",
  provider: "openai",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openAiBaseUrl: "https://api.openai.com/v1",
  openRouterApiKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  featureModels: {}
};
export function ConstructSettingsSurface({
  activeItemId,
  projectId,
  projects,
  theme,
  onThemeChange,
  onProjectsChange,
  onActiveProjectChange
}: {
  activeItemId: string;
  projectId?: string;
  projects: ProjectSummary[];
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onProjectsChange: (projects: ProjectSummary[]) => void;
  onActiveProjectChange: (project: ProjectRecord | null | ((current: ProjectRecord | null) => ProjectRecord | null)) => void;
}) {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const [workspaceRoot, setWorkspaceRootValue] = useState("");
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const [aiFeatures, setAiFeatures] = useState<AiFeatureSettings[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState(project?.title ?? "");
  const [projectDescription, setProjectDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteCheck, setDeleteCheck] = useState<DeleteProjectCheck | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [lspEnabled, setLspEnabled] = useState(() => {
    return window.localStorage.getItem("construct.lsp.enabled") !== "false";
  });
  const [lspStatus, setLspStatus] = useState<LspStatusReport>(() => createEmptyLspStatusReport());
  const [lspLogs, setLspLogs] = useState<string[]>([]);
  const [installBusy, setInstallBusy] = useState(false);
  const aggregateStatus = aggregateLspStatus(lspStatus);

  useEffect(() => {
    if (!projectId) return;

    let isMounted = true;
    const checkStatus = async () => {
      try {
        const status = await window.constructProjects.lspGetStatus(projectId);
        if (isMounted) {
          setLspStatus(status);
        }
      } catch (err) {
        console.error("Failed to check LSP status:", err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [projectId]);

  useEffect(() => {
    if (aggregateStatus === "installing" || installBusy) {
      setLspLogs(logStore.getLogs("lsp-server").map((l: LogEntry) => l.message));

      const unsubscribe = logStore.subscribe((channel: LogChannel, entry: LogEntry) => {
        if (channel === "lsp-server") {
          setLspLogs((prev) => [...prev, entry.message]);
        }
      });
      return unsubscribe;
    }
  }, [aggregateStatus, installBusy]);

  async function handleToggleLsp(enabled: boolean) {
    setLspEnabled(enabled);
    window.localStorage.setItem("construct.lsp.enabled", String(enabled));

    try {
      if (enabled) {
        if (projectId) {
          const status = await window.constructProjects.lspGetStatus(projectId);
          setLspStatus(status);
          if (aggregateLspStatus(status) !== "not-installed") {
            const startResult = await restartProjectLsp(projectId);
            setLspStatus(await window.constructProjects.lspGetStatus(projectId));
            if (startResult.languages.length > 0) {
              void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
            }
          }
        }
      } else {
        await window.constructProjects.lspStop();
        lspClient.dispose();
      }
    } catch (err) {
      console.error("Failed to toggle LSP:", err);
    }
  }

  async function handleInstallLsp() {
    if (!projectId) return;
    setInstallBusy(true);
    setLspStatus((current) => {
      const next = { ...current };
      for (const language of lspLanguageOrder) {
        next[language] = { ...next[language], status: "installing" };
      }
      return next;
    });
    setLspLogs([]);

    try {
      const success = await window.constructProjects.lspInstall(projectId);
      if (success) {
        const startResult = await restartProjectLsp(projectId);
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
        if (startResult.languages.length > 0) {
          void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
        }
      } else {
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      }
    } catch (err) {
      console.error("LSP installation error:", err);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleStartLsp() {
    if (!projectId) return;
    try {
      const startResult = await restartProjectLsp(projectId);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      if (startResult.languages.length > 0) {
        void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
      }
    } catch {}
  }

  async function handleStopLsp() {
    try {
      await window.constructProjects.lspStop();
      if (projectId) {
        setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      }
      lspClient.dispose();
    } catch {}
  }

  async function handleRestartLsp() {
    if (!projectId) return;
    try {
      const startResult = await restartProjectLsp(projectId);
      setLspStatus(await window.constructProjects.lspGetStatus(projectId));
      if (startResult.languages.length > 0) {
        void lspClient.initialize(project?.workspacePath || "", { force: true, languages: startResult.languages });
      }
    } catch {}
  }


  useEffect(() => {
    void getSettings()
      .then((settings) => {
        setWorkspaceRootValue(settings.workspaceRoot);
        setAiSettings({
          ...defaultAiSettings,
          ...(settings.ai ?? {})
        });
        return listAiFeatures();
      })
      .then((features) => setAiFeatures(features))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    const apiKey = aiSettings.provider === "openrouter"
      ? aiSettings.openRouterApiKey.trim()
      : aiSettings.openAiApiKey.trim();

    if (!apiKey) {
      setModelOptions([]);
      return;
    }

    void refreshModels(aiSettings.provider, apiKey);
  }, []);

  useEffect(() => {
    setProjectTitle(project?.title ?? "");
    setProjectDescription(project?.description ?? "");
  }, [project?.description, project?.title]);

  async function chooseRoot() {
    const directory = await selectWorkspaceDirectory({ defaultPath: workspaceRoot });
    if (directory) {
      setWorkspaceRootValue(directory);
    }
  }

  async function saveWorkspaceRoot() {
    if (!workspaceRoot.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const result = await setWorkspaceRoot({ workspaceRoot: workspaceRoot.trim() });
      onProjectsChange(result.projects);
      onActiveProjectChange((current) => {
        if (!current) {
          return current;
        }

        const summary = result.projects.find((item) => item.id === current.id);
        return summary ? { ...current, workspacePath: summary.workspacePath } : current;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refreshModels(provider = aiSettings.provider, apiKey?: string) {
    const resolvedKey = (apiKey ?? (provider === "openrouter" ? aiSettings.openRouterApiKey : aiSettings.openAiApiKey)).trim();
    if (!resolvedKey) {
      setModelsError(`Enter your ${provider === "openrouter" ? "OpenRouter" : "OpenAI"} API key first.`);
      setModelOptions([]);
      return;
    }

    try {
      setModelsBusy(true);
      setModelsError(null);
      const models = await listModels({ provider, apiKey: resolvedKey });
      setModelOptions(models);
      setAiSettings((current) => {
        if (provider === "openrouter") {
          const nextModel = current.openRouterModel && models.some((model) => model.id === current.openRouterModel)
            ? current.openRouterModel
            : (models[0]?.id ?? current.openRouterModel);
          return { ...current, openRouterModel: nextModel };
        }

        const nextModel = current.openAiModel && models.some((model) => model.id === current.openAiModel)
          ? current.openAiModel
          : (models[0]?.id ?? current.openAiModel);
        return { ...current, openAiModel: nextModel };
      });
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : String(caught));
      setModelOptions([]);
    } finally {
      setModelsBusy(false);
    }
  }

  function updateAiRuntime(runtime: AiSettings["runtime"]) {
    setAiSettings((current) => ({ ...current, runtime }));
  }

  function updateAiProvider(provider: AiSettings["provider"]) {
    setAiSettings((current) => ({ ...current, provider }));
    setModelOptions([]);
    setModelsError(null);
    setAiFeatures((features) => features.map((feature) => {
      const saved = aiSettings.featureModels[feature.id]?.trim();
      if (saved) return feature;
      const model = provider === "openrouter"
        ? feature.defaultOpenRouterModel
        : feature.defaultOpenAiModel;
      return { ...feature, model };
    }));
  }

  async function saveAiConfiguration() {
    try {
      setAiBusy(true);
      setModelsError(null);
      const settings = await updateAiSettings({ ai: aiSettings });
      setAiSettings({
        ...defaultAiSettings,
        ...(settings.ai ?? {})
      });
      setAiFeatures(await listAiFeatures());
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiBusy(false);
    }
  }

  function updateFeatureModel(featureId: string, model: string) {
    setAiSettings((current) => ({
      ...current,
      featureModels: {
        ...current.featureModels,
        [featureId]: model
      }
    }));
    setAiFeatures((current) => current.map((feature) => (
      feature.id === featureId ? { ...feature, model } : feature
    )));
  }

  async function handleDeleteClick() {
    if (!projectId) return;
    setDeleteError(null);
    try {
      const result = await deleteProject({ projectId });
      if ("deleted" in result) return;
      setDeleteCheck(result);
      setDeleteConfirmOpen(true);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleConfirmDelete() {
    if (!projectId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject({ projectId, force: true });
      setDeleteConfirmOpen(false);
      onActiveProjectChange(null);
      onProjectsChange(projects.filter((p) => p.id !== projectId));
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(false);
    }
  }

  async function saveProjectDetails() {
    if (!projectId || !projectTitle.trim()) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await updateProject({
        id: projectId,
        patch: {
          title: projectTitle.trim(),
          description: projectDescription.trim()
        }
      });
      onActiveProjectChange((current) => current && current.id === updated.id ? updated : current);
      onProjectsChange(projects.map((item) => (
        item.id === updated.id
          ? {
              ...item,
              title: updated.title,
              description: updated.description,
              progress: updated.progress,
              workspacePath: updated.workspacePath
            }
          : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (activeItemId === "appearance") {
    return (
      <SettingsPanel title="Appearance" subtitle="Theme source for Construct and the embedded editor shell.">
        <SettingsSection>
          <SettingsCard>
            <SettingsRow
              title="Color theme"
              description="Match the system appearance or keep Construct fixed to one mode."
              control={
                <Select value={theme} onValueChange={(value) => onThemeChange(value as ThemeMode)}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          </SettingsCard>
        </SettingsSection>
      </SettingsPanel>
    );
  }

  if (activeItemId === "lsp-settings") {
    return (
      <ConstructLspSettingsPanel
        enabled={lspEnabled}
        status={lspStatus}
        aggregateStatus={aggregateStatus}
        installBusy={installBusy}
        logs={lspLogs}
        error={error}
        onToggle={(enabled) => void handleToggleLsp(enabled)}
        onInstall={() => void handleInstallLsp()}
        onStart={() => void handleStartLsp()}
        onStop={() => void handleStopLsp()}
        onRestart={() => void handleRestartLsp()}
      />
    );
  }

  if (activeItemId.startsWith("project-") && project) {
    return (
      <SettingsPanel title={project.title} subtitle={project.workspacePath}>
        {activeItemId === "project-overview" ? (
          <SettingsSection title="Project details">
            <SettingsCard>
              <SettingsRow title="Title" description="Shown in the sidebar, dashboard, and shell history.">
                <Input
                  value={projectTitle}
                  onChange={(event) => setProjectTitle(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow title="Description" description="Used for local project summaries.">
                <Textarea
                  value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow
                title="Save project metadata"
                control={
                  <Button size="small" disabled={busy || !projectTitle.trim()} onClick={() => void saveProjectDetails()}>
                    Save
                  </Button>
                }
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-overview" ? (
          <SettingsSection title="Danger Zone">
            <SettingsCard>
              <SettingsRow
                title="Delete project"
                description="Permanently removes the project and its workspace folder. This action cannot be undone."
                control={
                  <Button variant="danger" size="small" onClick={() => void handleDeleteClick()}>
                    <Trash size={14} weight="duotone" style={{ marginRight: 4 }} />
                    Delete
                  </Button>
                }
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-runtime" ? (
          <SettingsSection title="Runtime">
            <SettingsCard>
              <SettingsRow title="Workspace path" description={project.workspacePath} />
              <SettingsRow title="Source file" description={project.sourcePath ?? "Local generated project"} />
              <SettingsRow title="Progress" description={`${project.progress}% complete`} />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-slots" ? (
          <SettingsSection title="Slots">
            <SettingsCard>
              <SettingsRow
                title="Guide and steps"
                description="Available in the right slot through the plus menu."
                control={<SettingsToggle checked disabled />}
              />
              <SettingsRow
                title="Persistent terminals"
                description="Terminal tabs keep their PTY until the tab is closed."
                control={<SettingsToggle checked disabled />}
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {error ? <Alert variant="destructive"><AlertTitle>Project settings error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {deleteError ? <Alert variant="destructive"><AlertTitle>Could not delete project</AlertTitle><AlertDescription>{deleteError}</AlertDescription></Alert> : null}

        <ShadcnDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <ShadcnDialogContent className="sm:max-w-lg">
            <ShadcnDialogHeader>
              <div className="mb-1 flex size-9 items-center justify-center rounded-md bg-destructive/10 text-destructive"><Trash size={20} weight="duotone" /></div>
              <ShadcnDialogTitle>Delete project</ShadcnDialogTitle>
              <ShadcnDialogDescription>{project?.workspacePath ?? ""}</ShadcnDialogDescription>
            </ShadcnDialogHeader>
            <div className="py-2">
              <div className="flex flex-col gap-2">
                <p>Are you sure you want to delete this project?</p>
                <p className="text-sm text-muted-foreground">This will permanently delete the workspace folder and all its contents. This action cannot be undone.</p>
              </div>

              {deleteCheck?.hasGit ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Git repository detected</AlertTitle>
                  <AlertDescription>
                  <ul className="list-disc pl-5">
                    <li>Branch: <strong>{deleteCheck.branch}</strong></li>
                    {deleteCheck.hasUncommittedChanges ? (
                      <li>You have <strong>uncommitted changes</strong> that will be lost.</li>
                    ) : null}
                    {deleteCheck.unpushedCommits > 0 ? (
                      <li>You have <strong>{deleteCheck.unpushedCommits} unpushed commit{deleteCheck.unpushedCommits === 1 ? "" : "s"}</strong> that will be lost.</li>
                    ) : null}
                    {!deleteCheck.hasUncommittedChanges && deleteCheck.unpushedCommits === 0 ? (
                      <li>All changes are committed and pushed. No data loss expected.</li>
                    ) : null}
                  </ul>
                  {deleteCheck.hasUncommittedChanges || deleteCheck.unpushedCommits > 0 ? (
                    <p className="mt-3">
                      Push your commits to a remote repository before deleting to avoid losing work.
                    </p>
                  ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {!deleteCheck?.hasGit && deleteCheck ? (
                <Alert className="mt-4">
                  <AlertTitle>No git repository found</AlertTitle>
                  <AlertDescription>The workspace will be permanently deleted.</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <ShadcnDialogFooter>
              <Button variant="secondary" size="small" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" size="small" onClick={() => void handleConfirmDelete()} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete project"}
              </Button>
            </ShadcnDialogFooter>
          </ShadcnDialogContent>
        </ShadcnDialog>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="Workspace" subtitle="Local project storage and app-wide Construct defaults.">
      <SettingsSection title="Storage">
        <SettingsCard>
          <SettingsRow title="Workspace root" description="New and imported projects are kept under this folder.">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Input
                className="min-w-0"
                value={workspaceRoot}
                onChange={(event) => setWorkspaceRootValue(event.target.value)}
              />
              <Button variant="secondary" size="small" onClick={() => void chooseRoot()}>
                Browse
              </Button>
              <Button size="small" disabled={busy || !workspaceRoot.trim()} onClick={() => void saveWorkspaceRoot()}>
                Save
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <ConstructAiSettingsSection
        settings={aiSettings}
        features={aiFeatures}
        modelOptions={modelOptions}
        modelsBusy={modelsBusy}
        aiBusy={aiBusy}
        modelsError={modelsError}
        onRuntimeChange={updateAiRuntime}
        onProviderChange={updateAiProvider}
        onOpenAiApiKeyChange={(openAiApiKey) => setAiSettings((current) => ({ ...current, openAiApiKey }))}
        onOpenAiBaseUrlChange={(openAiBaseUrl) => setAiSettings((current) => ({ ...current, openAiBaseUrl }))}
        onOpenRouterApiKeyChange={(openRouterApiKey) => setAiSettings((current) => ({ ...current, openRouterApiKey }))}
        onOpenRouterBaseUrlChange={(openRouterBaseUrl) => setAiSettings((current) => ({ ...current, openRouterBaseUrl }))}
        onRefreshModels={(provider) => void refreshModels(provider)}
        onFeatureModelChange={updateFeatureModel}
        onSave={() => void saveAiConfiguration()}
      />

      <SettingsSection title="About">
        <SettingsCard>
          <SettingsRow
            title="Supported protocols"
            description="Construct keeps older tape projects working while the protocol evolves."
            control={<code>tape-0.1 · tape-0.2 · tape-0.3 · tape-0.3.1</code>}
          />
        </SettingsCard>
      </SettingsSection>
      {error ? <Alert variant="destructive"><AlertTitle>Settings error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </SettingsPanel>
  );
}

export function buildSettingsSections(projects: ProjectSummary[], projectId?: string): SettingsNavSection[] {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const sections: SettingsNavSection[] = [
    {
      id: "app",
      label: "Construct",
      items: [
        { id: "workspace", label: "Workspace", icon: <Folder size={18} weight="duotone" /> },
        { id: "appearance", label: "Appearance", icon: <GearSix size={18} weight="duotone" /> },
        { id: "lsp-settings", label: "Language Server", icon: <Notebook size={18} weight="duotone" /> }
      ]
    }
  ];

  if (project) {
    sections.push({
      id: "project",
      label: "Project",
      items: [
        {
          id: "project-overview",
          label: project.title,
          icon: <Folder size={18} weight="duotone" />
        },
        {
          id: "project-runtime",
          label: "Runtime",
          icon: <TerminalWindow size={18} weight="duotone" />
        },
        {
          id: "project-slots",
          label: "Slots",
          icon: <PanelRight size={18} />,
          badge: `${project.progress}%`
        }
      ]
    });
  }

  return sections;
}

export function settingsTitle(itemId: string, projectId: string | undefined, projects: ProjectSummary[]) {
  if (itemId === "appearance") {
    return "Appearance";
  }
  if (itemId === "lsp-settings") {
    return "Language Server";
  }
  if (itemId.startsWith("project-") && projectId) {
    return projects.find((project) => project.id === projectId)?.title ?? "Project settings";
  }
  return "Settings";
}
