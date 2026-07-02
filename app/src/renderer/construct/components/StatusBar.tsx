import { useEffect, useState } from "react";
import { GitBranch, Loader2, Activity, Sun, Moon, Cpu, CheckCircle2, Power } from "lucide-react";
import { apiTracker, type ActiveCall } from "../lib/apiTracker";
import { litellmStatus, onLitellmStatusChange } from "../lib/bridge";
import type { LitellmState } from "../types";
import type { ThemeMode } from "../theme";

interface StatusBarProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export function StatusBar({ theme, onThemeChange }: StatusBarProps) {
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [settings, setSettings] = useState(apiTracker.getSettings());
  const [gitBranch, setGitBranch] = useState(apiTracker.getGitBranch());
  const [gitDirtyCount, setGitDirtyCount] = useState(apiTracker.getGitDirtyCount());
  const [lspStatus, setLspStatus] = useState(apiTracker.getLspStatus());
  const [litellmStatusState, setLitellmStatusState] = useState<LitellmState | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() => litellmStatus()).then(setLitellmStatusState).catch(() => {});
    let unsubscribe = () => {};
    try {
      unsubscribe = onLitellmStatusChange(setLitellmStatusState);
    } catch {
      // The Vite renderer can be opened without Electron preload during local smoke checks.
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Subscribe to apiTracker changes
    const unsubscribe = apiTracker.subscribe(() => {
      setActiveCalls([...apiTracker.getActiveCalls()]);
      setSettings(apiTracker.getSettings());
      setGitBranch(apiTracker.getGitBranch());
      setGitDirtyCount(apiTracker.getGitDirtyCount());
      setLspStatus(apiTracker.getLspStatus());
    });

    // Initial load
    setActiveCalls([...apiTracker.getActiveCalls()]);
    setSettings(apiTracker.getSettings());
    setGitBranch(apiTracker.getGitBranch());
    setGitDirtyCount(apiTracker.getGitDirtyCount());
    setLspStatus(apiTracker.getLspStatus());

    return unsubscribe;
  }, []);

  const provider = settings?.ai?.provider ?? "openai";
  const modelRaw = provider === "openrouter"
    ? (settings?.ai?.openRouterModel ?? "deepseek/deepseek-v4-flash")
    : provider === "opencode-zen"
      ? (settings?.ai?.opencodeZenModel ?? "gpt-5.1-codex")
      : provider === "github-copilot"
        ? (settings?.ai?.githubCopilotModel ?? "github_copilot/gpt-4")
        : provider === "litellm"
          ? (settings?.ai?.liteLlmModel ?? "openai/gpt-5-mini")
          : (settings?.ai?.openAiModel ?? "gpt-5-mini");

  const formatModelName = (name: string): string => {
    if (!name) return "";
    const parts = name.split("/");
    const lastPart = parts[parts.length - 1];
    return lastPart
      .split("-")
      .map(word => {
        const lower = word.toLowerCase();
        if (lower === "gpt") return "GPT";
        if (lower === "api") return "API";
        if (lower === "lsp") return "LSP";
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  };

  const formattedModel = formatModelName(modelRaw);
  const providerLabel = provider === "openrouter"
    ? "OpenRouter"
    : provider === "opencode-zen"
      ? "OpenCode Zen"
      : provider === "github-copilot"
        ? "GitHub Copilot"
        : provider === "litellm"
          ? "LiteLLM"
          : "OpenAI";
  const obsEnabled = settings?.observability?.enabled ?? false;

  const handleThemeToggle = () => {
    onThemeChange(theme === "dark" ? "light" : "dark");
  };

  // Get the latest active call to display
  const currentCall = activeCalls.length > 0 ? activeCalls[activeCalls.length - 1] : null;

  return (
    <div 
      className="flex h-[22px] min-h-[22px] w-full select-none items-center justify-between border-t border-border bg-sidebar/80 px-3 font-sans text-[11px] text-muted-foreground transition-all duration-150"
      style={{ zIndex: 100 }}
    >
      {/* Left Section: Git and Activity */}
      <div className="flex h-full items-center gap-3">
        {/* Git Branch Info */}
        {gitBranch && (
          <div
            className="flex h-full cursor-default items-center gap-1 rounded-[6px] px-1.5 transition-colors duration-150 hover:bg-accent hover:text-accent-foreground"
            title={`Git branch: ${gitBranch}`}
          >
            <GitBranch size={12} className="stroke-[2px]" />
            <span>{gitBranch}</span>
            {gitDirtyCount > 0 && (
              <span
                className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-amber-500"
                title={`${gitDirtyCount} modified files`}
              />
            )}
          </div>
        )}

        {/* API Usage & Status Indicator */}
        <div className="flex h-full items-center">
          {currentCall ? (
            <div className="flex items-center gap-1.5 text-primary">
              <Loader2 size={12} className="animate-spin text-primary" />
              <span>{currentCall.label}...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full bg-emerald-500" />
              <span>Ready</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Section: Telemetry, LSP, Model and Theme */}
      <div className="flex h-full items-center gap-2">
        {/* Observability Indicator */}
        {obsEnabled && (
          <div
            className="flex h-full items-center gap-1 px-1.5 text-emerald-500"
            title="Langfuse tracing is enabled"
          >
            <Activity size={12} className="stroke-[2.5px]" />
            <span>Langfuse Active</span>
          </div>
        )}

        {/* LSP Status Indicator */}
        <div 
          className="flex h-full items-center gap-1 px-1.5"
          title={lspStatus ? `LSP status: ${lspStatus}` : "Language Server Protocol Status"}
        >
          <span className="rounded-full bg-accent px-1.5 py-[1px] font-mono text-[10px] text-accent-foreground">LSP</span>
          <span>{lspStatus ? lspStatus : "Active"}</span>
        </div>

        {/* LiteLLM Server Status */}
        {litellmStatusState && provider === "litellm" ? (
          <div
            className="flex h-full items-center gap-1 px-1.5"
            title={`LiteLLM server: ${litellmStatusState.status}${litellmStatusState.error ? ` — ${litellmStatusState.error}` : ""}`}
          >
            <Power size={11} className={litellmStatusState.status === "running" ? "text-emerald-500" : litellmStatusState.status === "error" ? "text-destructive" : "text-muted-foreground"} />
            <span className="text-[10px] font-mono">
              {litellmStatusState.status === "running" ? `:${litellmStatusState.port}` : litellmStatusState.status}
            </span>
          </div>
        ) : null}

        {/* Model Identifier */}
        <div 
          className="flex h-full cursor-default items-center gap-1 rounded-[6px] px-1.5 transition-colors duration-150 hover:bg-accent hover:text-accent-foreground"
          title={`Active Provider: ${providerLabel}\nModel: ${modelRaw}`}
        >
          <Cpu size={11} className="text-amber-500 stroke-[2.5px]" />
          <span>{providerLabel}: {formattedModel}</span>
        </div>

        {/* Theme Quick Toggle */}
        <button 
          onClick={handleThemeToggle}
          className="flex h-full cursor-default items-center justify-center rounded-[6px] border-0 bg-transparent px-1.5 text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
        </button>
      </div>
    </div>
  );
}
