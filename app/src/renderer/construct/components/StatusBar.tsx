import { useEffect, useState } from "react";
import { GitBranch, Loader2, Activity, Sun, Moon, Sparkles, CheckCircle2 } from "lucide-react";
import { apiTracker, type ActiveCall } from "../lib/apiTracker";
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
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const obsEnabled = settings?.observability?.enabled ?? false;

  const handleThemeToggle = () => {
    onThemeChange(theme === "dark" ? "light" : "dark");
  };

  // Get the latest active call to display
  const currentCall = activeCalls.length > 0 ? activeCalls[activeCalls.length - 1] : null;

  return (
    <div 
      className="h-[22px] min-h-[22px] w-full flex items-center justify-between px-3 text-[11px] select-none border-t border-border bg-sidebar text-muted-foreground font-sans transition-all duration-150"
      style={{ zIndex: 100 }}
    >
      {/* Left Section: Git and Activity */}
      <div className="flex items-center gap-4 h-full">
        {/* Git Branch Info */}
        {gitBranch && (
          <div 
            className="flex items-center gap-1 hover:bg-accent hover:text-accent-foreground cursor-pointer px-1.5 h-full rounded transition-colors duration-150"
            title={`Git branch: ${gitBranch}`}
          >
            <GitBranch size={12} className="stroke-[2px]" />
            <span>{gitBranch}</span>
            {gitDirtyCount > 0 && (
              <span 
                className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse ml-0.5" 
                title={`${gitDirtyCount} modified files`}
              />
            )}
          </div>
        )}

        {/* API Usage & Status Indicator */}
        <div className="flex items-center h-full">
          {currentCall ? (
            <div className="flex items-center gap-1.5 text-primary">
              <Loader2 size={12} className="animate-spin text-primary" />
              <span>{currentCall.label}...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Ready</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Section: Telemetry, LSP, Model and Theme */}
      <div className="flex items-center gap-3 h-full">
        {/* Observability Indicator */}
        {obsEnabled && (
          <div 
            className="flex items-center gap-1 px-1.5 h-full text-emerald-500" 
            title="Arize Phoenix Telemetry is enabled and connected"
          >
            <Activity size={12} className="stroke-[2.5px]" />
            <span>Phoenix Active</span>
          </div>
        )}

        {/* LSP Status Indicator */}
        <div 
          className="flex items-center gap-1 px-1.5 h-full"
          title={lspStatus ? `LSP status: ${lspStatus}` : "Language Server Protocol Status"}
        >
          <span className="text-[10px] font-mono bg-accent text-accent-foreground px-1 py-[1px] rounded">LSP</span>
          <span>{lspStatus ? lspStatus : "Active"}</span>
        </div>

        {/* Model Identifier */}
        <div 
          className="flex items-center gap-1 hover:bg-accent hover:text-accent-foreground cursor-pointer px-1.5 h-full rounded transition-colors duration-150"
          title={`Active Provider: ${providerLabel}\nModel: ${modelRaw}`}
        >
          <Sparkles size={11} className="text-amber-500 stroke-[2.5px]" />
          <span>{providerLabel}: {formattedModel}</span>
        </div>

        {/* Theme Quick Toggle */}
        <button 
          onClick={handleThemeToggle}
          className="flex items-center justify-center hover:bg-accent hover:text-accent-foreground cursor-pointer px-1.5 h-full rounded transition-colors duration-150 border-0 bg-transparent text-muted-foreground outline-none"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
        </button>
      </div>
    </div>
  );
}
