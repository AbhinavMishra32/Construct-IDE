import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentSessionComposer } from "@opaline/ui";
import type { AiSettings, ModelCatalogEntry, ProjectSummary } from "../types";
import { getSettings, listModels, updateAiSettings } from "../lib/bridge";
import {
  apiKeyForProvider,
  flowFeatureModel,
  ensureModelOption,
  FlowComposerRightControls
} from "./FlowWorkspace";

const HEADLINES = [
  "Ready to learn your next obsession?",
  "Ready to hyperfocus on something brand new?",
  "Let's build something we probably don't need, but definitely want to understand.",
  "What logic maze are we getting lost in today?",
  "Ready to teach a silicon chip some new tricks?",
  "What system are we beautifully over-engineering today?",
  "Time to build. Coffee is optional, curiosity is not.",
  "Let's compile some wild ideas."
];

export function Dashboard({
  projects,
  busy,
  error,
  onCreateProjectFromPrompt,
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onCreateProjectFromPrompt: (prompt: string) => Promise<void>;
  onOpenProject?: (projectId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const aiSettingsRef = useRef<AiSettings | null>(null);

  const refreshModels = useCallback(async (settingsSnapshot?: AiSettings | null) => {
    const resolvedSettings = settingsSnapshot ?? aiSettingsRef.current;
    if (!resolvedSettings) return;
    setModelsBusy(true);
    setModelsError(null);
    try {
      const models = await listModels({
        provider: resolvedSettings.provider,
        apiKey: apiKeyForProvider(resolvedSettings)
      });
      setModelOptions(models);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      setModelOptions([]);
    } finally {
      setModelsBusy(false);
    }
  }, []);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
  }, [aiSettings]);

  useEffect(() => {
    let cancelled = false;
    void getSettings()
      .then((settings) => {
        if (cancelled) return;
        setAiSettings(settings.ai);
        void refreshModels(settings.ai);
      })
      .catch((error) => {
        if (!cancelled) setModelsError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshModels]);

  const activeFlowModel = useMemo(() => (
    aiSettings ? flowFeatureModel(aiSettings) : ""
  ), [aiSettings]);

  const flowModelOptions = useMemo(() => (
    ensureModelOption(modelOptions, activeFlowModel, aiSettings?.provider)
  ), [activeFlowModel, aiSettings?.provider, modelOptions]);

  const updateFlowModel = useCallback(async (model: string) => {
    if (!aiSettings) return;
    const featureModels = {
      ...(aiSettings.featureModels ?? {}),
      "construct-flow": model
    };
    const optimistic = { ...aiSettings, featureModels };
    setAiSettings(optimistic);
    setModelsError(null);
    try {
      const settings = await updateAiSettings({ ai: { featureModels } });
      setAiSettings(settings.ai);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      void getSettings().then((settings) => setAiSettings(settings.ai));
    }
  }, [aiSettings]);

  const updateReasoningEffort = useCallback(async (effort: AiSettings["reasoningEffort"]) => {
    if (!aiSettings) return;
    const optimistic = { ...aiSettings, reasoningEffort: effort };
    setAiSettings(optimistic);
    setModelsError(null);
    try {
      const settings = await updateAiSettings({ ai: { reasoningEffort: effort } });
      setAiSettings(settings.ai);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      void getSettings().then((settings) => setAiSettings(settings.ai));
    }
  }, [aiSettings]);

  const headline = useMemo(() => {
    const randomIndex = Math.floor(Math.random() * HEADLINES.length);
    return HEADLINES[randomIndex];
  }, []);

  async function submitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || creating) return;
    try {
      setCreating(true);
      setCreateError(null);
      await onCreateProjectFromPrompt(trimmed);
      setPrompt("");
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="construct-home-surface">
      <div className="construct-home-frame">

        <main className="construct-home-main">
          <div className="construct-home-stack">
            <div className="construct-home-input-container">
              <h1 className="construct-home-title">{headline}</h1>

              <AgentSessionComposer
                aria-label="Describe the project to create"
                className="construct-flow-composer construct-home-composer"
                disabled={busy}
                footerStart={
                  <span className="construct-home-composer-count">
                    {projects.length} project{projects.length === 1 ? "" : "s"}
                  </span>
                }
                footerEnd={
                  <FlowComposerRightControls
                    settings={aiSettings}
                    model={activeFlowModel}
                    models={flowModelOptions}
                    modelsBusy={modelsBusy}
                    modelsError={modelsError}
                    reasoningEffort={aiSettings?.reasoningEffort ?? "auto"}
                    onModelChange={updateFlowModel}
                    onReasoningEffortChange={updateReasoningEffort}
                  />
                }
                onSubmit={() => void submitPrompt()}
                onValueChange={setPrompt}
                pending={creating}
                placeholder="Build a local-first drawing app that teaches canvas architecture as we go..."
                submitLabel="Create Flow project"
                value={prompt}
              />
            </div>

            {createError || error ? (
              <div className="construct-home-error">
                {createError ?? error}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}



