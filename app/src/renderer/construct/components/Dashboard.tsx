import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2Icon, CircleAlertIcon, PlusIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";

import { AgentRunTrace, AgentSessionComposer, Button } from "@opaline/ui";
import type { AgentRunTraceEntry } from "@opaline/ui";
import type { ConstructFlowSession, ConstructFlowSessionEvent, ConstructFlowTimelinePart } from "../../../shared/constructFlow";
import { ConstructAuthLogo } from "../../components/auth/construct-auth-logo";
import type { AiSettings, FlowProjectRecord, ModelCatalogEntry, ProjectSummary } from "../types";
import { getSettings, listModels, onConstructFlowSessionEvent, updateAiSettings } from "../lib/bridge";
import {
  apiKeyForProvider,
  flowFeatureModel,
  modelSettingsKeyForProvider,
  modelOptionsForActiveAgent,
  FlowComposerRightControls
} from "./FlowWorkspace";
import { HomeProjectPicker } from "./HomeProjectPicker";
import type { ComposerProvider } from "./ProviderModelPicker";

type HomeResearchPhase = "idle" | "creating" | "researching" | "handoff" | "starting" | "opening" | "error";

type HomeResearchRun = {
  phase: HomeResearchPhase;
  goal: string;
  project: FlowProjectRecord | null;
  sessions: ConstructFlowSession[];
  liveSession?: ConstructFlowSession;
  opening?: boolean;
  error?: string | null;
};

const homeMotionTransition = {
  layout: { duration: 0.62, ease: [0.16, 0.84, 0.22, 1] },
  opacity: { duration: 0.22 }
} as const;

export function Dashboard({
  projects,
  busy,
  error,
  onCreateProjectFromPrompt,
  onOpenProject,
  onProjectReady,
}: {
  projects: ProjectSummary[];
  busy: boolean;
  error: string | null;
  onCreateProjectFromPrompt: (prompt: string) => Promise<FlowProjectRecord>;
  onProjectReady: (project: FlowProjectRecord) => Promise<void>;
  onOpenProject?: (projectId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [researchRun, setResearchRun] = useState<HomeResearchRun | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelCatalogEntry[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const aiSettingsRef = useRef<AiSettings | null>(null);
  const onProjectReadyRef = useRef(onProjectReady);
  const researchRunRef = useRef<HomeResearchRun | null>(null);
  const openingProjectIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onProjectReadyRef.current = onProjectReady;
  }, [onProjectReady]);

  const assignResearchRun = useCallback((next: HomeResearchRun | null) => {
    researchRunRef.current = next;
    setResearchRun(next);
  }, []);

  const openProjectWhenReady = useCallback(async (project: FlowProjectRecord) => {
    if (openingProjectIdsRef.current.has(project.id)) return;
    openingProjectIdsRef.current.add(project.id);
    const openingRun = researchRunRef.current?.project?.id === project.id
      ? { ...researchRunRef.current, phase: "opening" as const, opening: true }
      : researchRunRef.current;
    assignResearchRun(openingRun);
    try {
      await sleep(480);
      const current = researchRunRef.current;
      const projectSnapshot = current?.project?.id === project.id
        ? withHomeResearchSessions(current.project, current.sessions)
        : project;
      await onProjectReadyRef.current(projectSnapshot);
    } catch (error) {
      openingProjectIdsRef.current.delete(project.id);
      const current = researchRunRef.current;
      assignResearchRun(current?.project?.id === project.id
        ? {
            ...current,
            phase: "error",
            opening: false,
            error: error instanceof Error ? error.message : String(error)
          }
        : current
      );
    }
  }, [assignResearchRun]);

  useEffect(() => {
    const unsubscribe = onConstructFlowSessionEvent((event: ConstructFlowSessionEvent) => {
      const current = researchRunRef.current;
      if (!current?.project || event.projectId !== current.project.id) return;
      const isResearch = event.session.threadId === `${current.project.flow.threadId}:research`;
      const sessions = upsertHomeResearchSession(current.sessions, event.session);
      const terminal = isTerminalHomeFlowSession(event.session);
      let phase = current.phase;
      let error = current.error;
      let projectToOpen: FlowProjectRecord | null = null;

      if (isResearch) {
        if (event.type === "error" || event.session.status === "error") {
          phase = "error";
          error = event.session.errorMessage ?? "Research stopped before the mentor could start.";
        } else {
          phase = terminal ? "starting" : "researching";
          if (terminal) {
            projectToOpen = current.project;
          }
        }
      } else if (terminal) {
        phase = "opening";
        projectToOpen = current.project;
      } else {
        phase = "starting";
        projectToOpen = current.project;
      }

      assignResearchRun({
        ...current,
        phase,
        error,
        sessions,
        liveSession: terminal ? undefined : event.session
      });

      if (projectToOpen) {
        void openProjectWhenReady(projectToOpen);
      }
    });
    return unsubscribe;
  }, [openProjectWhenReady]);

  const refreshModels = useCallback(async (settingsSnapshot?: AiSettings | null) => {
    const resolvedSettings = settingsSnapshot ?? aiSettingsRef.current;
    if (!resolvedSettings) return;
    setModelsBusy(true);
    setModelsError(null);
    try {
      const models = await listModels({
        provider: resolvedSettings.source === "construct-cloud" ? "construct-cloud" : resolvedSettings.provider,
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
    modelOptionsForActiveAgent(modelOptions, activeFlowModel, aiSettings?.source === "construct-cloud" ? "construct-cloud" : aiSettings?.provider)
  ), [activeFlowModel, aiSettings?.provider, aiSettings?.source, modelOptions]);

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

  const loadProviderModels = useCallback(async (provider: ComposerProvider) => {
    const settings = aiSettingsRef.current;
    if (!settings) return [];
    return listModels({
      provider,
      apiKey: apiKeyForProvider(settings, provider)
    });
  }, []);

  const updateProviderModel = useCallback(async (provider: ComposerProvider, model: string) => {
    if (!aiSettings) return;
    const modelKey = modelSettingsKeyForProvider(provider);
    const patch = provider === "construct-cloud"
      ? { source: "construct-cloud" as const, featureModels: {}, [modelKey]: model }
      : { source: "byok" as const, provider, featureModels: {}, [modelKey]: model };
    const optimistic = { ...aiSettings, ...patch };
    setAiSettings(optimistic);
    setModelOptions([]);
    setModelsError(null);
    try {
      const settings = await updateAiSettings({ ai: patch });
      setAiSettings(settings.ai);
      await refreshModels(settings.ai);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : String(error));
      const settings = await getSettings();
      setAiSettings(settings.ai);
      await refreshModels(settings.ai);
    }
  }, [aiSettings, refreshModels]);

  async function submitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || creating) return;
    try {
      setCreating(true);
      setCreateError(null);
      assignResearchRun({
        phase: "creating",
        goal: trimmed,
        project: null,
        sessions: []
      });
      const project = await onCreateProjectFromPrompt(trimmed);
      const current = researchRunRef.current;
      assignResearchRun(current?.goal === trimmed
        ? {
            ...current,
            phase: "researching",
            project,
            sessions: project.flow.sessions ?? []
          }
        : current
      );
      setPrompt("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setCreateError(message);
      assignResearchRun(null);
    } finally {
      setCreating(false);
    }
  }

  const activeHomeRun = researchRun && researchRun.phase !== "idle" ? researchRun : null;
  const homeBusy = busy || creating || Boolean(activeHomeRun);

  return (
    <div className="construct-home-surface">
      <div className="construct-home-frame">

        <main className={`construct-home-main${activeHomeRun ? " is-researching" : ""}`}>
          <div className={`construct-home-stack${activeHomeRun ? " is-researching" : ""}`}>
            <AnimatePresence mode="wait" initial={false}>
              {activeHomeRun ? (
                <HomeResearchCard key="research" run={activeHomeRun} />
              ) : (
                <motion.div
                  key="composer"
                  className="construct-home-input-container"
                  layoutId="construct-home-project-start"
                  transition={homeMotionTransition}
                >
                  <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-visible bg-[var(--color-background-surface)] px-[var(--app-density-chat-gutter-x,0.75rem)] sm:px-[var(--app-density-chat-gutter-x-lg,1.25rem)]">
                    <div className="flex w-full flex-col justify-center">
                      <header className="mx-auto flex w-full max-w-[46rem] flex-col items-center gap-4 px-6 pb-5 text-center select-none">
                        <ConstructAuthLogo markClassName="size-10" />
                        <h2
                          className="font-display text-[26px] font-[450] leading-[1.15] tracking-[-0.015em] text-foreground/95 sm:text-[30px]"
                          data-testid="empty-landing-heading"
                        >
                          What should we work on?
                        </h2>
                      </header>

                      <div className="w-full overflow-visible" data-empty-landing-composer-block="true">
                        <AgentSessionComposer
                          aria-label="Describe the project to create"
                          className="construct-flow-composer construct-home-composer relative z-10"
                          disabled={homeBusy}
                          footerStart={
                            <>
                              <Button
                                aria-label="Choose a project"
                                onClick={() => setProjectPickerOpen(true)}
                                size="icon-xs"
                                title="Choose a project"
                                type="button"
                                variant="chrome"
                              >
                                <PlusIcon data-icon="inline-start" />
                              </Button>
                              <span className="inline-flex h-7 shrink-0 items-center gap-1.5 px-1.5 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--runtime-full-access-accent)]">
                                <ShieldCheckIcon className="size-3.5" />
                                Full access
                              </span>
                            </>
                          }
                          footerEnd={
                            <FlowComposerRightControls
                              settings={aiSettings}
                              model={activeFlowModel}
                              models={flowModelOptions}
                              modelsBusy={modelsBusy}
                              modelsError={modelsError}
                              reasoningEffort={aiSettings?.reasoningEffort ?? "auto"}
                              onLoadProviderModels={loadProviderModels}
                              onProviderModelChange={updateProviderModel}
                              onReasoningEffortChange={updateReasoningEffort}
                            />
                          }
                          onSubmit={() => void submitPrompt()}
                          onValueChange={setPrompt}
                          pending={creating}
                          placeholder="Ask for follow-up changes or attach images"
                          submitLabel="Create Construct project"
                          value={prompt}
                        />

                        <div className="chat-composer-shell relative z-0 mx-auto -mt-5 flex min-h-8 w-full max-w-[46rem] min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden !rounded-t-none !rounded-b-[var(--composer-radius)] bg-[color-mix(in_srgb,var(--color-background-elevated-secondary)_76%,var(--color-background-surface)_24%)] px-2 pb-1.5 pt-6 sm:min-h-7">
                          <HomeProjectPicker
                            onOpenChange={setProjectPickerOpen}
                            onOpenProject={(projectId) => onOpenProject?.(projectId)}
                            open={projectPickerOpen}
                            projects={projects}
                          />
                          <div className="min-w-0 flex-1" />
                        </div>
                      </div>
                    </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>

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

function HomeResearchCard({ run }: { run: HomeResearchRun }) {
  const reduceMotion = useReducedMotion();
  const [searchesExpanded, setSearchesExpanded] = useState(false);
  const projectTitle = run.project?.title ?? "New Construct project";
  const researchSession = useMemo(() => {
    if (!run.project) return undefined;
    const researchThreadId = `${run.project.flow.threadId}:research`;
    return [...run.sessions].reverse().find((session) => session.threadId === researchThreadId);
  }, [run.project, run.sessions]);
  const latestSession = run.liveSession ?? researchSession ?? run.sessions[run.sessions.length - 1];
  const traceEntries = useMemo(() => buildHomeResearchTraceEntries(latestSession, run.phase), [latestSession, run.phase]);
  const searches = useMemo(() => collectHomeResearchSearches(researchSession), [researchSession]);
  const stageItems = useMemo(() => buildHomeResearchStages(run.phase), [run.phase]);
  const activeStage = stageItems.find((item) => item.status === "active" || item.status === "error") ?? stageItems[stageItems.length - 1];
  const visibleTraceEntries = traceEntries.slice(-8);
  const latestSearchLimit = 4;
  const hiddenSearchCount = Math.max(0, searches.length - latestSearchLimit);
  const visibleSearches = searchesExpanded ? searches : searches.slice(-latestSearchLimit);

  useEffect(() => {
    setSearchesExpanded(false);
  }, [run.project?.id]);

  return (
    <motion.section
      className="construct-home-research-card"
      layoutId="construct-home-project-start"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.992 }}
      transition={homeMotionTransition}
      aria-live="polite"
    >
      <div className="construct-home-research-header">
        <span
          className="construct-home-research-mark"
          data-phase={run.phase}
        >
          {run.phase === "error" ? <CircleAlertIcon size={15} /> : run.phase === "opening" ? <CheckCircle2Icon size={15} /> : <span className="construct-home-research-status-dot" />}
        </span>
        <div className="min-w-0 flex-1">
          <h1>{homeResearchTitle(run.phase)}</h1>
          <p>{projectTitle}</p>
        </div>
        <span className="construct-home-research-pill">
          {run.phase === "error" ? <CircleAlertIcon size={13} /> : run.phase === "opening" ? <CheckCircle2Icon size={13} /> : <span className="construct-home-research-status-dot" />}
          {homeResearchPill(run.phase)}
        </span>
      </div>

      <div className="construct-home-research-goal">
        <span>Project intent</span>
        <strong>{run.goal}</strong>
      </div>

      <div className="construct-home-research-progress" aria-label="Research startup progress">
        {stageItems.map((item) => (
          <span className="construct-home-research-step" data-status={item.status} key={item.id}>
            <span className="construct-home-research-step-dot">
              {item.status === "complete" ? <CheckCircle2Icon size={11} /> : item.status === "active" ? <span className="construct-home-research-status-dot" /> : item.status === "error" ? <CircleAlertIcon size={11} /> : null}
            </span>
            <span>{item.title}</span>
          </span>
        ))}
      </div>

      <div className="construct-home-research-live">
        <div className="construct-home-research-live-header">
          <span>{activeStage?.title ?? "Working"}</span>
          <small>{activeStage?.detail}</small>
        </div>
        <AgentRunTrace
          className="construct-home-research-agent-trace"
          state={run.phase === "researching" || run.phase === "starting" ? "thinking" : "thought"}
          entries={visibleTraceEntries}
          defaultOpen={visibleTraceEntries.length <= 4}
        />
      </div>

      {searches.length > 0 ? (
        <div className={`construct-home-research-search-list${searchesExpanded ? " is-expanded" : ""}`} aria-label="Internet searches">
          {visibleSearches.map((search) => (
            <span className="construct-home-research-search" data-status={search.status} key={search.id}>
              <SearchIcon size={12} />
              <span>{search.query}</span>
            </span>
          ))}
          {hiddenSearchCount > 0 ? (
            <button
              type="button"
              className="construct-home-research-search-more"
              aria-expanded={searchesExpanded}
              onClick={() => setSearchesExpanded((expanded) => !expanded)}
            >
              {searchesExpanded ? "show less" : `+${hiddenSearchCount} more`}
            </button>
          ) : null}
        </div>
      ) : null}

      {run.error ? (
        <div className="construct-home-error">{run.error}</div>
      ) : null}
    </motion.section>
  );
}

function buildHomeResearchStages(phase: HomeResearchPhase): Array<{
  id: string;
  title: string;
  detail: string;
  status: "pending" | "active" | "complete" | "error";
}> {
  const researchStatus = phase === "error"
    ? "error"
    : phase === "creating" || phase === "researching"
      ? "active"
      : "complete";
  const handoffStatus = phase === "error"
    ? "pending"
    : phase === "handoff"
      ? "active"
      : phase === "starting" || phase === "opening"
        ? "complete"
        : "pending";
  const mentorStatus = phase === "error"
    ? "pending"
    : phase === "starting"
      ? "active"
      : phase === "opening"
        ? "complete"
        : "pending";

  return [
    {
      id: "research",
      title: "Research project context",
      detail: "Domain, stack, references, and risks for research.md.",
      status: researchStatus
    },
    {
      id: "handoff",
      title: "Save mentor handoff",
      detail: "Persisting the assumptions the mentor should continue from.",
      status: handoffStatus
    },
    {
      id: "mentor",
      title: "Start Construct agent",
      detail: "System kickoff, greeting, and first mentor move.",
      status: mentorStatus
    }
  ];
}

function homeResearchTitle(phase: HomeResearchPhase): string {
  if (phase === "creating") return "Preparing research";
  if (phase === "handoff") return "Research saved";
  if (phase === "starting") return "Starting Construct agent";
  if (phase === "opening") return "Opening project";
  if (phase === "error") return "Research needs attention";
  return "Researching project";
}

function homeResearchPill(phase: HomeResearchPhase): string {
  if (phase === "handoff") return "handoff";
  if (phase === "starting") return "mentor";
  if (phase === "opening") return "ready";
  if (phase === "error") return "stopped";
  return "live";
}

function buildHomeResearchTraceEntries(session: ConstructFlowSession | undefined, phase: HomeResearchPhase): AgentRunTraceEntry[] {
  if (!session) {
    return [{
      id: "home-research-preparing",
      kind: "thought",
      title: phase === "creating" ? "Creating Flow memory" : "Waiting for research",
      status: phase === "error" ? "error" : "running",
      output: phase === "creating"
        ? "Construct is creating the project folder and Flow Memory files before the research agent starts."
        : "The research agent has not emitted a timeline event yet."
    }];
  }

  const entries = homeResearchTimelineParts(session)
    .filter((part) => part.kind !== "message" || Boolean(part.text.trim()))
    .map(homeResearchTimelinePartToTraceEntry);

  if (entries.length > 0) return entries;

  return [{
    id: `${session.id}:working`,
    kind: "thought",
    title: session.status === "completed" ? "Research completed" : "Working",
    status: session.status === "error" ? "error" : session.status === "completed" ? "completed" : "running",
    output: session.messages.at(-1)?.content
  }];
}

function homeResearchTimelineParts(session: ConstructFlowSession): ConstructFlowTimelinePart[] {
  if (session.timeline?.length) return [...session.timeline].sort(compareHomeTimelineParts);
  return (session.toolCalls ?? []).map((toolCall): ConstructFlowTimelinePart => ({
    id: toolCall.id,
    kind: "tool",
    toolCallId: toolCall.id,
    name: toolCall.name,
    title: toolCall.title,
    reason: toolCall.reason,
    status: toolCall.status,
    input: toolCall.input,
    outputPreview: toolCall.outputPreview,
    createdAt: toolCall.createdAt,
    completedAt: toolCall.completedAt
  })).sort(compareHomeTimelineParts);
}

function homeResearchTimelinePartToTraceEntry(part: ConstructFlowTimelinePart): AgentRunTraceEntry {
  if (part.kind === "reasoning") {
    return {
      id: part.id,
      kind: "thought",
      title: part.title || "Thinking",
      subtitle: part.detail,
      status: homeTraceStatus(part.status),
      output: part.text
    };
  }
  if (part.kind === "message") {
    return {
      id: part.id,
      kind: "thought",
      title: "Research note",
      status: homeTraceStatus(part.status),
      output: part.text
    };
  }
  if (part.kind === "compaction") {
    return {
      id: part.id,
      kind: "tool",
      title: part.title,
      subtitle: part.detail,
      status: homeTraceStatus(part.status),
      icon: "memory",
      output: part.summary
    };
  }

  return {
    id: part.id,
    kind: "tool",
    title: part.title,
    subtitle: part.reason,
    status: homeTraceStatus(part.status),
    icon: homeToolIcon(part.name),
    input: stringifyHomeTraceValue(part.input),
    output: part.outputPreview
  };
}

function collectHomeResearchSearches(session: ConstructFlowSession | undefined): Array<{
  id: string;
  query: string;
  status?: AgentRunTraceEntry["status"];
}> {
  if (!session) return [];
  return homeResearchTimelineParts(session)
    .filter((part): part is Extract<ConstructFlowTimelinePart, { kind: "tool" }> => part.kind === "tool" && isHomeInternetSearchTool(part.name))
    .map((part) => {
      const input = readHomeTraceObject(part.input);
      const query = typeof input?.query === "string" ? input.query : part.reason || part.title;
      return {
        id: part.id,
        query,
        status: homeTraceStatus(part.status)
      };
    });
}

function isHomeInternetSearchTool(name: string): boolean {
  return name === "internet-search" || name === "internetSearch";
}

function homeToolIcon(name: string): AgentRunTraceEntry["icon"] {
  if (name.includes("search")) return "search";
  if (name.includes("fetch")) return "read";
  if (name.includes("memory")) return "memory";
  if (name.includes("read") || name === "view") return "read";
  if (name.includes("file") || name.includes("glob") || name.includes("grep")) return "file";
  return "tool";
}

function homeTraceStatus(status: ConstructFlowTimelinePart["status"]): AgentRunTraceEntry["status"] {
  if (status === "error") return "error";
  if (status === "completed") return "completed";
  return "running";
}

function compareHomeTimelineParts(left: ConstructFlowTimelinePart, right: ConstructFlowTimelinePart): number {
  return homeTimelineTime(left) - homeTimelineTime(right);
}

function homeTimelineTime(part: ConstructFlowTimelinePart): number {
  const timestamp = Date.parse(part.createdAt ?? part.updatedAt ?? ("completedAt" in part ? part.completedAt ?? "" : ""));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function upsertHomeResearchSession(sessions: ConstructFlowSession[], session: ConstructFlowSession): ConstructFlowSession[] {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index < 0) return [...sessions, session];
  return sessions.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate);
}

function withHomeResearchSessions(project: FlowProjectRecord, sessions: ConstructFlowSession[]): FlowProjectRecord {
  const mergedSessions = sessions.reduce(upsertHomeResearchSession, project.flow.sessions ?? []);
  const researchThreadId = `${project.flow.threadId}:research`;
  const completedResearchSession = mergedSessions.find((session) => (
    session.threadId === researchThreadId && session.status === "completed"
  ));
  const updatedAt = mergedSessions.at(-1)?.updatedAt ?? project.flow.updatedAt;
  return {
    ...project,
    flow: {
      ...project.flow,
      researchEnabled: project.flow.researchEnabled || Boolean(completedResearchSession),
      researchCompletedAt: completedResearchSession?.updatedAt ?? project.flow.researchCompletedAt,
      sessions: mergedSessions,
      updatedAt
    }
  };
}

function isTerminalHomeFlowSession(session: ConstructFlowSession): boolean {
  return session.status === "completed" || session.status === "error" || session.status === "waiting";
}

function readHomeTraceObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringifyHomeTraceValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
