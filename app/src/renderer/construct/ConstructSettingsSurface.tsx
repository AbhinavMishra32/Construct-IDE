import { useDeferredValue, useEffect, useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { FileCode, Folder, GearSix, Notebook, TerminalWindow, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
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
import { validateConstructSource } from "./compiler/pipeline";
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
  listProjects,
  listModels,
  importOpencodeAuth,
  litellmCheckInstall,
  litellmInstall,
  litellmStart,
  litellmStatus,
  litellmStop,
  onAgentLog,
  onLitellmStatusChange,
  selectWorkspaceDirectory,
  setWorkspaceRoot,
  updateAppSettings,
  updateAiSettings,
  updateProject,
  readFlowMemory,
  readProjectTape,
  updateFlowMemory,
  updateProjectTape
} from "./lib/bridge";
import { parseConstructSource } from "./lib/parser";
import { showProviderUpdateToast } from "./components/ProviderUpdateToast";
import type {
  AiFeatureSettings,
  AiSettings,
  AnyProjectRecord,
  DeleteProjectCheck,
  LitellmState,
  ModelCatalogEntry,
  ProjectSummary
} from "./types";
import type { ConstructFlowMemoryRead, FlowMemoryFileName } from "../../shared/constructFlow";
import type { ThemeMode } from "./theme";

const defaultAiSettings: AiSettings = {
  runtime: "mastra",
  source: "byok",
  provider: "openai",
  reasoningEffort: "auto",
  openAiApiKey: "",
  openAiModel: "gpt-5-mini",
  openAiBaseUrl: "https://api.openai.com/v1",
  openRouterApiKey: "",
  openRouterModel: "deepseek/deepseek-v4-flash",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  liteLlmApiKey: "",
  liteLlmModel: "openai/gpt-5-mini",
  liteLlmBaseUrl: "http://localhost:4000/v1",
  liteLlmManageServer: false,
  opencodeZenApiKey: "",
  opencodeZenBaseUrl: "https://opencode.ai/zen/v1",
  opencodeZenModel: "gpt-5.1-codex",
  githubCopilotModel: "github_copilot/gpt-4",
  constructCloudBaseUrl: "https://cloud.tryconstruct.cc",
  constructCloudAccessToken: "",
  constructCloudModel: "deepseek/deepseek-v4-flash",
  tavilyApiKey: "",
  featureModels: {},
  codeGhostEnabled: true,
  conceptFirewallEnabled: true
};

const flowMemoryFiles: FlowMemoryFileName[] = [
  "research.md",
  "project.md",
  "path.md",
  "learner.md"
];

type ModelLookupProvider = AiSettings["provider"] | "construct-cloud";

function modelSettingsKeyForProvider(provider: ModelLookupProvider): "openAiModel" | "openRouterModel" | "opencodeZenModel" | "githubCopilotModel" | "liteLlmModel" | "constructCloudModel" {
  if (provider === "construct-cloud") return "constructCloudModel";
  if (provider === "openrouter") return "openRouterModel";
  if (provider === "opencode-zen") return "opencodeZenModel";
  if (provider === "github-copilot") return "githubCopilotModel";
  if (provider === "litellm") return "liteLlmModel";
  return "openAiModel";
}

function defaultModelForFeature(provider: ModelLookupProvider, feature: AiFeatureSettings): string {
  if (provider === "construct-cloud") return feature.defaultConstructCloudModel;
  if (provider === "openrouter") return feature.defaultOpenRouterModel;
  if (provider === "opencode-zen") return feature.defaultOpenCodeZenModel;
  if (provider === "github-copilot") return feature.defaultGithubCopilotModel;
  if (provider === "litellm") return feature.defaultLiteLlmModel;
  return feature.defaultOpenAiModel;
}

const flowMemoryLabels: Record<FlowMemoryFileName, { title: string; description: string }> = {
  "research.md": {
    title: "Research",
    description: "External docs, repo findings, and project-specific technical notes."
  },
  "project.md": {
    title: "Project",
    description: "Goal, architecture map, important files, commands, and constraints."
  },
  "path.md": {
    title: "Path",
    description: "Current direction, recent progress, likely next moves, blockers, and handoff notes."
  },
  "learner.md": {
    title: "Learner",
    description: "The learner's current strengths, weak spots, help level, and learning evidence."
  }
};

export function ConstructSettingsSurface({
  activeItemId,
  projectId,
  projects,
  theme,
  showStatusBar,
  onThemeChange,
  onShowStatusBarChange,
  onProjectsChange,
  onActiveProjectChange
}: {
  activeItemId: string;
  projectId?: string;
  projects: ProjectSummary[];
  theme: ThemeMode;
  showStatusBar: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onShowStatusBarChange: (showStatusBar: boolean) => void;
  onProjectsChange: (projects: ProjectSummary[]) => void;
  onActiveProjectChange: (project: AnyProjectRecord | null | ((current: AnyProjectRecord | null) => AnyProjectRecord | null)) => void;
}) {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const isFlowProject = project?.kind === "flow";
  const [workspaceRoot, setWorkspaceRootValue] = useState("");
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const aiSettingsRef = useRef(aiSettings);
  aiSettingsRef.current = aiSettings;
  const [aiFeatures, setAiFeatures] = useState<AiFeatureSettings[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [litellmState, setLitellmState] = useState<LitellmState>({ status: "stopped", port: 4000, pid: null, error: null });
  const [projectTitle, setProjectTitle] = useState(project?.title ?? "");
  const [projectDescription, setProjectDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [appBusy, setAppBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteCheck, setDeleteCheck] = useState<DeleteProjectCheck | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tapeEditorOpen, setTapeEditorOpen] = useState(false);
  const [tapeSource, setTapeSource] = useState("");
  const [tapeSourcePath, setTapeSourcePath] = useState<string | null>(null);
  const [tapeLoaded, setTapeLoaded] = useState(false);
  const [tapeBusy, setTapeBusy] = useState(false);
  const [tapeError, setTapeError] = useState<string | null>(null);
  const deferredTapeSource = useDeferredValue(tapeSource);
  const tapeValidation = tapeLoaded ? validateConstructSource(deferredTapeSource) : null;
  const tapeErrors = tapeValidation?.diagnostics.filter((diagnostic) => diagnostic.severity === "error") ?? [];
  const [flowMemory, setFlowMemory] = useState<ConstructFlowMemoryRead[]>([]);

  function setAiSettingsDraft(update: AiSettings | ((current: AiSettings) => AiSettings)) {
    setAiSettings((current) => {
      const next = typeof update === "function" ? update(current) : update;
      aiSettingsRef.current = next;
      return next;
    });
  }
  const [flowMemoryDrafts, setFlowMemoryDrafts] = useState<Record<FlowMemoryFileName, string>>({
    "research.md": "",
    "project.md": "",
    "path.md": "",
    "learner.md": ""
  });
  const [flowMemoryLoaded, setFlowMemoryLoaded] = useState(false);
  const [flowMemoryBusy, setFlowMemoryBusy] = useState(false);
  const [flowMemorySaving, setFlowMemorySaving] = useState<FlowMemoryFileName | null>(null);
  const [flowMemoryError, setFlowMemoryError] = useState<string | null>(null);

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
        onShowStatusBarChange(settings.app?.showStatusBar !== false);
        setAiSettingsDraft({
          ...defaultAiSettings,
          ...(settings.ai ?? {})
        });
        return listAiFeatures();
      })
      .then((features) => setAiFeatures(features))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [onShowStatusBarChange]);

  useEffect(() => {
    if (aiSettings.provider === "opencode-zen" || aiSettings.provider === "github-copilot" || aiSettings.provider === "litellm") {
      void refreshModels(aiSettings.source === "construct-cloud" ? "construct-cloud" : aiSettings.provider);
      return;
    }

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

  useEffect(() => {
    void litellmStatus().then(setLitellmState).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onLitellmStatusChange((state) => {
      setLitellmState(state);
    });
    return unsubscribe;
  }, []);

  function extractPort(baseUrl: string): number {
    try {
      const url = new URL(baseUrl);
      return Number(url.port) || 4000;
    } catch {
      return 4000;
    }
  }

  async function handleLitellmStart() {
    const port = extractPort(aiSettings.liteLlmBaseUrl);
    const installed = await litellmCheckInstall();
    if (!installed) {
      const ok = window.confirm(
        "litellm is not installed. Install it now via pip3? (requires Python 3)"
      );
      if (!ok) return;
      const success = await litellmInstall();
      if (!success) {
        setLitellmState((prev) => ({ ...prev, status: "error", error: "Failed to install litellm. Try: pip3 install litellm" }));
        return;
      }
    }
    const state = await litellmStart({
      port,
      openAiApiKey: aiSettings.openAiApiKey || undefined,
      openRouterApiKey: aiSettings.openRouterApiKey || undefined
    });
    setLitellmState(state);
    if (state.status === "running") {
      void refreshModels("litellm");
    }
  }

  async function handleLitellmStop() {
    const state = await litellmStop();
    setLitellmState(state);
  }

  useEffect(() => {
    if (activeItemId !== "project-flow-memory" || !projectId || !isFlowProject) {
      setFlowMemoryLoaded(false);
      setFlowMemoryError(null);
      return;
    }

    let cancelled = false;
    setFlowMemoryBusy(true);
    setFlowMemoryError(null);
    void readFlowMemory({ projectId })
      .then((entries) => {
        if (cancelled) return;
        const drafts = createFlowMemoryDrafts(entries);
        setFlowMemory(entries);
        setFlowMemoryDrafts(drafts);
        setFlowMemoryLoaded(true);
      })
      .catch((caught) => {
        if (!cancelled) {
          setFlowMemoryError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFlowMemoryBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeItemId, isFlowProject, projectId]);

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

  async function handleShowStatusBarChange(showStatusBarNext: boolean) {
    const previous = showStatusBar;
    onShowStatusBarChange(showStatusBarNext);

    try {
      setAppBusy(true);
      setError(null);
      const settings = await updateAppSettings({
        app: {
          showStatusBar: showStatusBarNext
        }
      });
      onShowStatusBarChange(settings.app?.showStatusBar !== false);
      toast.success(settings.app?.showStatusBar !== false ? "Status bar shown" : "Status bar hidden");
    } catch (caught) {
      onShowStatusBarChange(previous);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAppBusy(false);
    }
  }

  async function refreshModels(provider: ModelLookupProvider = aiSettings.source === "construct-cloud" ? "construct-cloud" : aiSettings.provider, apiKey?: string) {
    const usesLiteLlm = provider === "github-copilot" || provider === "litellm";
    const resolvedKey = (apiKey ?? (
      provider === "construct-cloud" ? aiSettings.constructCloudAccessToken
      : provider === "openrouter" ? aiSettings.openRouterApiKey
      : provider === "openai" ? aiSettings.openAiApiKey
      : provider === "opencode-zen" ? aiSettings.opencodeZenApiKey
      : aiSettings.liteLlmApiKey
    )).trim();
    if (!usesLiteLlm && !resolvedKey && provider !== "opencode-zen" && provider !== "openrouter" && provider !== "openai") {
      setModelsError("Enter an API key first.");
      setModelOptions([]);
      return;
    }
    if (!usesLiteLlm && !resolvedKey && (provider === "openai" || provider === "construct-cloud")) {
      setModelsError(provider === "construct-cloud" ? "Enter your Construct Cloud desktop token first." : "Enter your OpenAI API key first.");
      setModelOptions([]);
      return;
    }

    try {
      setModelsBusy(true);
      setModelsError(null);
      if (usesLiteLlm) {
        showProviderUpdateToast("running");
      }
      const models = await listModels({ provider, apiKey: resolvedKey });
      if (usesLiteLlm) {
        showProviderUpdateToast("succeeded");
      }
      setModelOptions(models);
      setAiSettingsDraft((current) => {
        const key = modelSettingsKeyForProvider(provider);
        const currentModel = current[key];
        const nextModel = currentModel && models.some((model) => model.id === currentModel)
          ? currentModel
          : (models[0]?.id ?? currentModel);
        return { ...current, [key]: nextModel };
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (usesLiteLlm) {
        showProviderUpdateToast("failed", message);
      }
      setModelsError(message);
      setModelOptions([]);
    } finally {
      setModelsBusy(false);
    }
  }

  function updateAiRuntime(runtime: AiSettings["runtime"]) {
    setAiSettingsDraft((current) => ({ ...current, runtime }));
  }

  function updateAiProvider(provider: AiSettings["provider"]) {
    setAiSettingsDraft((current) => ({ ...current, provider }));
    setModelOptions([]);
    setModelsError(null);
    setAiFeatures((features) => features.map((feature) => {
      const saved = aiSettings.featureModels[feature.id]?.trim();
      if (saved) return feature;
      const model = defaultModelForFeature(provider, feature);
      return { ...feature, model };
    }));
  }

  function updateAiSource(source: AiSettings["source"]) {
    setAiSettingsDraft((current) => ({ ...current, source }));
    setModelOptions([]);
    setModelsError(null);
    const provider = source === "construct-cloud" ? "construct-cloud" : aiSettingsRef.current.provider;
    setAiFeatures((features) => features.map((feature) => {
      const saved = aiSettingsRef.current.featureModels[feature.id]?.trim();
      if (saved) return feature;
      return { ...feature, model: defaultModelForFeature(provider, feature) };
    }));
  }

  async function saveAiConfiguration() {
    try {
      setAiBusy(true);
      setModelsError(null);
      const settings = await updateAiSettings({ ai: aiSettingsRef.current });
      setAiSettingsDraft({
        ...defaultAiSettings,
        ...(settings.ai ?? {})
      });
      setAiFeatures(await listAiFeatures());
      toast.success("AI settings saved");
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAiBusy(false);
    }
  }

  function updateFeatureModel(featureId: string, model: string) {
    setAiSettingsDraft((current) => ({
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

  function updateGlobalModel(model: string) {
    setAiSettingsDraft((current) => {
      const key = modelSettingsKeyForProvider(current.source === "construct-cloud" ? "construct-cloud" : current.provider);
      return {
        ...current,
        [key]: model,
        featureModels: {}
      };
    });
    setAiFeatures((current) => current.map((feature) => ({
      ...feature,
      model: model || defaultModelForFeature(aiSettingsRef.current.source === "construct-cloud" ? "construct-cloud" : aiSettingsRef.current.provider, feature)
    })));
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

  async function openTapeEditor() {
    if (!projectId || isFlowProject) return;
    setTapeEditorOpen(true);
    setTapeBusy(true);
    setTapeError(null);
    setTapeLoaded(false);
    try {
      const tape = await readProjectTape(projectId);
      setTapeSource(tape.source);
      setTapeSourcePath(tape.sourcePath);
      setTapeLoaded(true);
    } catch (caught) {
      setTapeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTapeBusy(false);
    }
  }

  async function saveTapeSource() {
    if (!projectId || isFlowProject) return;
    const validation = validateConstructSource(tapeSource);
    if (!validation.valid) {
      setTapeError("Fix the tape errors before saving.");
      return;
    }

    try {
      setTapeBusy(true);
      setTapeError(null);
      const program = parseConstructSource(validation.source);
      const updated = await updateProjectTape({
        projectId,
        source: validation.source,
        originalSource: tapeSource,
        authoringFixes: validation.appliedFixes.map((fix) => ({
          id: fix.id,
          title: fix.title,
          description: fix.description,
          kind: fix.kind,
          safety: fix.safety,
          line: fix.line,
          appliedAt: fix.appliedAt
        })),
        program
      });
      setTapeSource(validation.source);
      onActiveProjectChange((current) => current?.id === updated.id ? updated : current);
      onProjectsChange(await listProjects());
      setProjectTitle(updated.title);
      setProjectDescription(updated.description);
      setTapeEditorOpen(false);
      setTapeLoaded(false);
    } catch (caught) {
      setTapeError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTapeBusy(false);
    }
  }

  async function saveFlowMemoryFile(file: FlowMemoryFileName) {
    if (!projectId || !isFlowProject) return;

    try {
      setFlowMemorySaving(file);
      setFlowMemoryError(null);
      const updatedEntries = await updateFlowMemory({
        projectId,
        updates: [{ file, content: flowMemoryDrafts[file] }]
      });
      setFlowMemory((current) => mergeFlowMemoryEntries(current, updatedEntries));
      setFlowMemoryDrafts((current) => ({
        ...current,
        ...createFlowMemoryDrafts(updatedEntries, current)
      }));
      toast.success(`${flowMemoryLabels[file].title} memory saved`);
    } catch (caught) {
      setFlowMemoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setFlowMemorySaving(null);
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
            <SettingsRow
              title="Bottom status bar"
              description="Show git, runtime, model, telemetry, and theme quick controls at the bottom of the window."
              control={
                <SettingsToggle
                  checked={showStatusBar}
                  disabled={appBusy}
                  onCheckedChange={(checked) => void handleShowStatusBarChange(checked)}
                />
              }
            />
          </SettingsCard>
        </SettingsSection>
        {error ? <Alert variant="destructive"><AlertTitle>Appearance settings error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
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

        {activeItemId === "project-flow-memory" && isFlowProject ? (
          <SettingsSection title="Flow Memory">
            <SettingsCard>
              <SettingsRow
                title="Memory directory"
                description=".construct keeps Flow's durable context readable, editable, and source-control friendly."
              />
              {flowMemoryBusy && !flowMemoryLoaded ? (
                <SettingsRow title="Loading memory" description="Reading the current Flow memory files." />
              ) : null}
              {flowMemoryFiles.map((file) => {
                const entry = flowMemory.find((item) => item.file === file);
                const metadata = flowMemoryLabels[file];
                const changed = flowMemoryDrafts[file] !== (entry?.content ?? "");
                return (
                  <SettingsRow
                    key={file}
                    title={metadata.title}
                    description={`${metadata.description}${entry?.updatedAt ? ` Last updated ${new Date(entry.updatedAt).toLocaleString()}.` : ""}`}
                  >
                    <div className="flex flex-col gap-2">
                      <Textarea
                        aria-label={`${metadata.title} memory`}
                        className="min-h-40 resize-y font-mono text-xs leading-5"
                        value={flowMemoryDrafts[file]}
                        onChange={(event) => {
                          setFlowMemoryDrafts((current) => ({ ...current, [file]: event.target.value }));
                          setFlowMemoryError(null);
                        }}
                        spellCheck={false}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <code className="text-xs text-muted-foreground">{entry?.path ?? `.construct/${file}`}</code>
                        <Button
                          size="small"
                          disabled={flowMemoryBusy || flowMemorySaving !== null || !changed}
                          onClick={() => void saveFlowMemoryFile(file)}
                        >
                          {flowMemorySaving === file ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    </div>
                  </SettingsRow>
                );
              })}
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {activeItemId === "project-advanced" && !isFlowProject ? (
          <SettingsSection title="Advanced">
            <SettingsCard>
              <SettingsRow
                title="Tape source"
                description={project.sourcePath ?? "Managed inside this Construct project"}
                control={
                  <Button size="small" variant="secondary" onClick={() => void openTapeEditor()}>
                    <FileCode size={14} weight="duotone" style={{ marginRight: 4 }} />
                    Edit tape
                  </Button>
                }
              />
              <SettingsRow
                title="What saving changes"
                description="Validates the tape, reloads the active project structure, updates the managed tape artifact, and writes the imported .construct file when present. Existing workspace edits are preserved."
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}

        {error ? <Alert variant="destructive"><AlertTitle>Project settings error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {flowMemoryError ? <Alert variant="destructive"><AlertTitle>Flow memory error</AlertTitle><AlertDescription>{flowMemoryError}</AlertDescription></Alert> : null}
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

        <ShadcnDialog
          open={tapeEditorOpen}
          onOpenChange={(open) => {
            setTapeEditorOpen(open);
            if (!open) {
              setTapeLoaded(false);
              setTapeError(null);
            }
          }}
        >
          <ShadcnDialogContent className="flex max-h-[88vh] flex-col sm:max-w-4xl">
            <ShadcnDialogHeader>
              <div className="mb-1 flex size-9 items-center justify-center rounded-md bg-muted text-foreground"><FileCode size={20} weight="duotone" /></div>
              <ShadcnDialogTitle>Edit project tape</ShadcnDialogTitle>
              <ShadcnDialogDescription>{tapeSourcePath ?? "Managed project tape"}</ShadcnDialogDescription>
            </ShadcnDialogHeader>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
              {tapeBusy && !tapeLoaded ? (
                <div className="animate-pulse rounded-md border bg-muted/25 p-4 text-sm text-muted-foreground">Loading tape source...</div>
              ) : (
                <Textarea
                  aria-label="Project tape source"
                  className="min-h-[26rem] resize-y font-mono text-xs leading-5"
                  value={tapeSource}
                  onChange={(event) => {
                    setTapeSource(event.target.value);
                    setTapeError(null);
                  }}
                  spellCheck={false}
                />
              )}

              {tapeLoaded && tapeValidation ? (
                tapeValidation.valid ? (
                  <Alert>
                    <AlertTitle>Valid tape</AlertTitle>
                    <AlertDescription>
                      {tapeValidation.appliedFixes.length > 0
                        ? `${tapeValidation.appliedFixes.length} safe repair${tapeValidation.appliedFixes.length === 1 ? "" : "s"} will be applied when saved.`
                        : "The tape is ready to save."}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <AlertTitle>{tapeErrors.length} tape error{tapeErrors.length === 1 ? "" : "s"}</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc space-y-1 pl-5">
                        {tapeErrors.slice(0, 6).map((diagnostic) => (
                          <li key={`${diagnostic.id}:${diagnostic.line}`}>Line {diagnostic.line}: {diagnostic.message}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )
              ) : null}

              {tapeError ? <Alert variant="destructive"><AlertTitle>Could not save tape</AlertTitle><AlertDescription>{tapeError}</AlertDescription></Alert> : null}
            </div>

            <ShadcnDialogFooter>
              <Button variant="secondary" onClick={() => setTapeEditorOpen(false)}>Cancel</Button>
              <Button disabled={tapeBusy || !tapeLoaded || !tapeValidation?.valid} onClick={() => void saveTapeSource()}>
                {tapeBusy ? "Saving..." : "Save and reload tape"}
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
        onSourceChange={updateAiSource}
        onProviderChange={updateAiProvider}
        onReasoningEffortChange={(reasoningEffort) => setAiSettingsDraft((current) => ({ ...current, reasoningEffort }))}
        onCodeGhostEnabledChange={(codeGhostEnabled: boolean) => setAiSettingsDraft((current) => ({ ...current, codeGhostEnabled }))}
        onConceptFirewallEnabledChange={(conceptFirewallEnabled: boolean) => setAiSettingsDraft((current) => ({ ...current, conceptFirewallEnabled }))}
        onOpenAiApiKeyChange={(openAiApiKey: string) => setAiSettingsDraft((current) => ({ ...current, openAiApiKey }))}
        onOpenAiBaseUrlChange={(openAiBaseUrl: string) => setAiSettingsDraft((current) => ({ ...current, openAiBaseUrl }))}
        onOpenRouterApiKeyChange={(openRouterApiKey: string) => setAiSettingsDraft((current) => ({ ...current, openRouterApiKey }))}
        onOpenRouterBaseUrlChange={(openRouterBaseUrl: string) => setAiSettingsDraft((current) => ({ ...current, openRouterBaseUrl }))}
        onLiteLlmApiKeyChange={(liteLlmApiKey: string) => setAiSettingsDraft((current) => ({ ...current, liteLlmApiKey }))}
        onLiteLlmBaseUrlChange={(liteLlmBaseUrl: string) => setAiSettingsDraft((current) => ({ ...current, liteLlmBaseUrl }))}
        onOpencodeZenApiKeyChange={(opencodeZenApiKey: string) => setAiSettingsDraft((current) => ({ ...current, opencodeZenApiKey }))}
        onOpencodeZenBaseUrlChange={(opencodeZenBaseUrl: string) => setAiSettingsDraft((current) => ({ ...current, opencodeZenBaseUrl }))}
        onTavilyApiKeyChange={(tavilyApiKey: string) => setAiSettingsDraft((current) => ({ ...current, tavilyApiKey }))}
        onConstructCloudBaseUrlChange={(constructCloudBaseUrl: string) => setAiSettingsDraft((current) => ({ ...current, constructCloudBaseUrl }))}
        onConstructCloudAccessTokenChange={(constructCloudAccessToken: string) => setAiSettingsDraft((current) => ({ ...current, constructCloudAccessToken }))}
        onOpenRouterModelChange={updateGlobalModel}
        onOpenAiModelChange={updateGlobalModel}
        onOpencodeZenModelChange={updateGlobalModel}
        onGithubCopilotModelChange={updateGlobalModel}
        onLiteLlmModelChange={updateGlobalModel}
        onConstructCloudModelChange={updateGlobalModel}
        onRefreshModels={(provider) => { void refreshModels(provider); }}
        onFeatureModelChange={updateFeatureModel}
        onSave={() => { void saveAiConfiguration(); }}
        onImportOpencodeAuth={async (): Promise<string | null> => {
          try {
            const apiKey = await importOpencodeAuth();
            if (apiKey) {
              setAiSettingsDraft((current) => ({ ...current, opencodeZenApiKey: apiKey }));
              toast.success("OpenCode Zen API key imported from opencode CLI");
            } else {
              toast.error("No OpenCode API key found in opencode auth file.");
            }
            return apiKey;
          } catch {
            toast.error("Failed to import OpenCode API key.");
            return null;
          }
        }}
        litellmState={litellmState}
        onLitellmStart={handleLitellmStart}
        onLitellmStop={handleLitellmStop}
      />

      <SettingsSection title="About">
        <SettingsCard>
          <SettingsRow
            title="Supported protocols"
            description="Construct keeps older tape projects working while the protocol evolves."
            control={<code>tape-0.1 · tape-0.2 · tape-0.3 · tape-0.3.1 · tape-0.4 · tape-0.4.1 · tape-0.4.2</code>}
          />
        </SettingsCard>
      </SettingsSection>
      {error ? <Alert variant="destructive"><AlertTitle>Settings error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    </SettingsPanel>
  );
}

export function buildSettingsSections(projects: ProjectSummary[], projectId?: string): SettingsNavSection[] {
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  const isFlowProject = project?.kind === "flow";
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
        },
        ...(isFlowProject
          ? [
              {
                id: "project-flow-memory",
                label: "Flow Memory",
                icon: <FileCode size={18} weight="duotone" />
              }
            ]
          : [
              {
                id: "project-advanced",
                label: "Advanced",
                icon: <GearSix size={18} weight="duotone" />
              }
            ])
      ]
    });
  }

  return sections;
}

function createFlowMemoryDrafts(
  entries: ConstructFlowMemoryRead[],
  base?: Record<FlowMemoryFileName, string>
): Record<FlowMemoryFileName, string> {
  const drafts: Record<FlowMemoryFileName, string> = base
    ? { ...base }
    : {
        "research.md": "",
        "project.md": "",
        "path.md": "",
        "learner.md": ""
      };

  for (const entry of entries) {
    drafts[entry.file] = entry.content;
  }

  return drafts;
}

function mergeFlowMemoryEntries(
  current: ConstructFlowMemoryRead[],
  updated: ConstructFlowMemoryRead[]
): ConstructFlowMemoryRead[] {
  const byFile = new Map<FlowMemoryFileName, ConstructFlowMemoryRead>();
  for (const entry of current) {
    byFile.set(entry.file, entry);
  }
  for (const entry of updated) {
    byFile.set(entry.file, entry);
  }
  return flowMemoryFiles.map((file) => byFile.get(file)).filter((entry): entry is ConstructFlowMemoryRead => Boolean(entry));
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
