import { useState } from "react";
import { Play, Square, DownloadSimple } from "@phosphor-icons/react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsCard,
  SettingsRow,
  SettingsSection
} from "@opaline/ui";

import type { AiFeatureSettings, AiSettings, ModelCatalogEntry } from "../../types";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { ConstructCloudAccountPanel } from "./ConstructCloudAccountPanel";

const RECOMMENDED_OPENAI_MODELS = [
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
  { id: "gpt-5-nano", name: "GPT-5 Nano" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" }
];

const RECOMMENDED_OPENROUTER_MODELS = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { id: "openai/gpt-4.1-nano", name: "GPT-4.1 Nano" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B" }
];

const RECOMMENDED_OPENCODE_ZEN_MODELS: ModelCatalogEntry[] = [
  { id: "gpt-5.1-codex", name: "GPT 5.1 Codex", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5.2-codex", name: "GPT 5.2 Codex", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gpt-5-nano", name: "GPT 5 Nano", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", providerId: "opencode-zen", providerName: "OpenCode Zen" },
  { id: "gemini-3-pro", name: "Gemini 3 Pro", providerId: "opencode-zen", providerName: "OpenCode Zen" }
];

const RECOMMENDED_GITHUB_COPILOT_MODELS = [
  { id: "github_copilot/gpt-4", name: "GPT-4", providerId: "github-copilot", providerName: "GitHub Copilot" },
  { id: "github_copilot/gpt-5.1-codex", name: "GPT-5.1 Codex", providerId: "github-copilot", providerName: "GitHub Copilot" }
];

const RECOMMENDED_LITELLM_MODELS = [
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini", providerId: "openai", providerName: "OpenAI" },
  { id: "openrouter/deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "openrouter", providerName: "OpenRouter" },
  { id: "github_copilot/gpt-4", name: "GPT-4", providerId: "github-copilot", providerName: "GitHub Copilot" }
];

const RECOMMENDED_CONSTRUCT_CLOUD_MODELS = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "construct-cloud", providerName: "Construct Cloud" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", providerId: "construct-cloud", providerName: "Construct Cloud" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini", providerId: "construct-cloud", providerName: "Construct Cloud" }
];

type AiProvider = AiSettings["provider"];
type AiSource = AiSettings["source"];
type AiRuntime = AiSettings["runtime"];
type ModelLookupProvider = AiProvider | "construct-cloud";

export function ConstructAiSettingsSection({
  settings,
  features,
  modelOptions,
  modelsBusy,
  aiBusy,
  modelsError,
  onRuntimeChange,
  onSourceChange,
  onProviderChange,
  onReasoningEffortChange,
  onCodeGhostEnabledChange,
  onConceptFirewallEnabledChange,
  onOpenAiApiKeyChange,
  onOpenAiBaseUrlChange,
  onOpenRouterApiKeyChange,
  onOpenRouterBaseUrlChange,
  onLiteLlmApiKeyChange,
  onLiteLlmBaseUrlChange,
  onTavilyApiKeyChange,
  onLiteLlmModelChange,
  onOpenRouterModelChange,
  onOpenAiModelChange,
  onOpencodeZenApiKeyChange,
  onOpencodeZenBaseUrlChange,
  onOpencodeZenModelChange,
  onGithubCopilotModelChange,
  onConstructCloudBaseUrlChange,
  onConstructCloudAccessTokenChange,
  onConstructCloudModelChange,
  onRefreshModels,
  onFeatureModelChange,
  onSave,
  onImportOpencodeAuth,
  litellmState,
  onLitellmStart,
  onLitellmStop
}: {
  settings: AiSettings;
  features: AiFeatureSettings[];
  modelOptions: ModelCatalogEntry[];
  modelsBusy: boolean;
  aiBusy: boolean;
  modelsError: string | null;
  onRuntimeChange: (runtime: AiRuntime) => void;
  onSourceChange: (source: AiSource) => void;
  onProviderChange: (provider: AiProvider) => void;
  onReasoningEffortChange: (effort: AiSettings["reasoningEffort"]) => void;
  onCodeGhostEnabledChange: (enabled: boolean) => void;
  onConceptFirewallEnabledChange?: (enabled: boolean) => void;
  onOpenAiApiKeyChange: (apiKey: string) => void;
  onOpenAiBaseUrlChange: (baseUrl: string) => void;
  onOpenRouterApiKeyChange: (apiKey: string) => void;
  onOpenRouterBaseUrlChange: (baseUrl: string) => void;
  onLiteLlmApiKeyChange: (apiKey: string) => void;
  onLiteLlmBaseUrlChange: (baseUrl: string) => void;
  onTavilyApiKeyChange: (apiKey: string) => void;
  onLiteLlmModelChange: (model: string) => void;
  onOpenRouterModelChange: (model: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onOpencodeZenApiKeyChange: (apiKey: string) => void;
  onOpencodeZenBaseUrlChange: (baseUrl: string) => void;
  onOpencodeZenModelChange: (model: string) => void;
  onGithubCopilotModelChange: (model: string) => void;
  onConstructCloudBaseUrlChange: (baseUrl: string) => void;
  onConstructCloudAccessTokenChange: (accessToken: string) => void;
  onConstructCloudModelChange: (model: string) => void;
  onRefreshModels: (provider: ModelLookupProvider) => void;
  onFeatureModelChange: (featureId: string, model: string) => void;
  onSave: () => void;
  onImportOpencodeAuth?: () => Promise<string | null>;
  litellmState?: { status: string; port: number; pid: number | null; error: string | null };
  onLitellmStart?: () => void;
  onLitellmStop?: () => void;
}) {
  const [showBaseUrl, setShowBaseUrl] = useState(false);
  const [showFeatureModels, setShowFeatureModels] = useState(false);

  const usesConstructCloud = settings.source === "construct-cloud";
  const usesLiteLlmProxy = settings.provider === "github-copilot" || settings.provider === "litellm";
  const activeModelProvider: ModelLookupProvider = usesConstructCloud ? "construct-cloud" : settings.provider;

  const recommended = usesConstructCloud
    ? RECOMMENDED_CONSTRUCT_CLOUD_MODELS
    : settings.provider === "openrouter"
    ? RECOMMENDED_OPENROUTER_MODELS
    : settings.provider === "opencode-zen"
      ? RECOMMENDED_OPENCODE_ZEN_MODELS
      : settings.provider === "github-copilot"
        ? RECOMMENDED_GITHUB_COPILOT_MODELS
        : settings.provider === "litellm"
          ? RECOMMENDED_LITELLM_MODELS
      : RECOMMENDED_OPENAI_MODELS;

  const globalModel = usesConstructCloud
    ? settings.constructCloudModel
    : settings.provider === "openrouter"
    ? settings.openRouterModel
    : settings.provider === "opencode-zen"
      ? settings.opencodeZenModel
      : settings.provider === "github-copilot"
        ? settings.githubCopilotModel
        : settings.provider === "litellm"
          ? settings.liteLlmModel
      : settings.openAiModel;

  const onGlobalModelChange = usesConstructCloud
    ? onConstructCloudModelChange
    : settings.provider === "openrouter"
    ? onOpenRouterModelChange
    : settings.provider === "opencode-zen"
      ? onOpencodeZenModelChange
      : settings.provider === "github-copilot"
        ? onGithubCopilotModelChange
        : settings.provider === "litellm"
          ? onLiteLlmModelChange
      : onOpenAiModelChange;

  const baseModels = modelOptions.length > 0 ? modelOptions : recommended;

  const providerLabel = usesConstructCloud
    ? "Construct Cloud"
    : settings.provider === "openrouter"
    ? "OpenRouter"
    : settings.provider === "opencode-zen"
      ? "OpenCode Zen"
      : settings.provider === "github-copilot"
        ? "GitHub Copilot"
        : settings.provider === "litellm"
          ? "LiteLLM"
      : "OpenAI";

  return (
    <SettingsSection title="AI">
      <SettingsCard>

        {/* Provider */}
        <SettingsRow title="Agent Runtime" description="Choose the runtime adapter used by Construct agents.">
          <Select
            value={settings.runtime}
            onValueChange={(value) => onRuntimeChange(value === "fxpnt" ? "fxpnt" : "mastra")}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Select runtime" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mastra">Mastra</SelectItem>
              <SelectItem value="fxpnt">FXPNT</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow title="LLM calls" description="BYOK uses local keys. Construct Cloud uses your account and hosted usage limits.">
          <Select
            value={settings.source}
            onValueChange={(value) => onSourceChange(value === "construct-cloud" ? "construct-cloud" : "byok")}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="byok">BYOK</SelectItem>
              <SelectItem value="construct-cloud">Construct Cloud</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {!usesConstructCloud ? (
          <SettingsRow title="AI Provider" description="Choose which provider to route local BYOK requests through.">
            <Select
              value={settings.provider}
              onValueChange={(value) => onProviderChange(
                value === "openrouter"
                || value === "github-copilot"
                || value === "opencode-zen"
                || value === "litellm"
                  ? value
                  : "openai"
              )}
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="opencode-zen">OpenCode Zen</SelectItem>
                <SelectItem value="github-copilot">GitHub Copilot</SelectItem>
                <SelectItem value="litellm">LiteLLM Proxy</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        ) : null}

        <SettingsRow title="Thinking effort" description="Controls reasoning effort for models and providers that support it. Auto leaves the provider default alone.">
          <Select
            value={settings.reasoningEffort}
            onValueChange={(value) => onReasoningEffortChange(normalizeReasoningEffort(value ?? "auto"))}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Select effort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow title="Enable Code Ghost" description="Turn on Code Ghost Agent / inline code explanations in the editor. If disabled, Construct won't request explanations or make API calls.">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border border-muted-foreground bg-background text-primary focus:ring-1 focus:ring-ring focus:ring-offset-2"
              checked={settings.codeGhostEnabled}
              onChange={(event) => onCodeGhostEnabledChange(event.target.checked)}
            />
            <span className="text-xs text-muted-foreground">{settings.codeGhostEnabled ? "Enabled" : "Disabled"}</span>
          </div>
        </SettingsRow>

        <SettingsRow title="Concept Firewall" description="Enable Project Concept Firewall. If enabled, file writes, tasks, and replies will be audited against introduced project concepts. If disabled, there are no concept constraints.">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border border-muted-foreground bg-background text-primary focus:ring-1 focus:ring-ring focus:ring-offset-2"
              checked={settings.conceptFirewallEnabled !== false}
              onChange={(event) => onConceptFirewallEnabledChange?.(event.target.checked)}
            />
            <span className="text-xs text-muted-foreground">{settings.conceptFirewallEnabled !== false ? "Enabled" : "Disabled"}</span>
          </div>
        </SettingsRow>

        {/* Credentials — changes per provider */}
        {usesConstructCloud ? (
          <SettingsRow title="Construct Cloud account" description="Sign in with Better Auth, then mint a desktop token for hosted LLM calls.">
            <ConstructCloudAccountPanel
              baseUrl={settings.constructCloudBaseUrl}
              accessToken={settings.constructCloudAccessToken}
              disabled={aiBusy}
              onBaseUrlChange={onConstructCloudBaseUrlChange}
              onAccessTokenChange={onConstructCloudAccessTokenChange}
            />
          </SettingsRow>
        ) : settings.provider === "openai" ? (
          <div>
            <SettingsRow title="API Key" description="Stored locally by Construct.">
              <Input
                type="password"
                value={settings.openAiApiKey}
                placeholder="sk-..."
                onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
              />
            </SettingsRow>
            <div className="px-4 py-2">
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowBaseUrl(!showBaseUrl)}
              >
                {showBaseUrl ? "Hide" : "Show"} Base URL
              </button>
              {showBaseUrl ? (
                <SettingsRow title="">
                  <Input
                    value={settings.openAiBaseUrl}
                    placeholder="https://api.openai.com/v1"
                    onChange={(event) => onOpenAiBaseUrlChange(event.target.value)}
                  />
                </SettingsRow>
              ) : null}
            </div>
          </div>
        ) : settings.provider === "openrouter" ? (
          <div>
            <SettingsRow title="API Key" description="Stored locally by Construct.">
              <Input
                type="password"
                value={settings.openRouterApiKey}
                placeholder="sk-or-..."
                onChange={(event) => onOpenRouterApiKeyChange(event.target.value)}
              />
            </SettingsRow>
            <div className="px-4 py-2">
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowBaseUrl(!showBaseUrl)}
              >
                {showBaseUrl ? "Hide" : "Show"} Base URL
              </button>
              {showBaseUrl ? (
                <SettingsRow title="">
                  <Input
                    value={settings.openRouterBaseUrl}
                    placeholder="https://openrouter.ai/api/v1"
                    onChange={(event) => onOpenRouterBaseUrlChange(event.target.value)}
                  />
                </SettingsRow>
              ) : null}
            </div>
          </div>
        ) : settings.provider === "opencode-zen" ? (
          <div>
            <SettingsRow title="API Key" description="Get yours at opencode.ai/auth">
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  className="flex-1"
                  value={settings.opencodeZenApiKey}
                  placeholder="sk-..."
                  onChange={(event) => onOpencodeZenApiKeyChange(event.target.value)}
                />
                {onImportOpencodeAuth ? (
                  <Button
                    size="small"
                    variant="secondary"
                    title="Import API key from opencode CLI auth file"
                    onClick={() => { void onImportOpencodeAuth(); }}
                  >
                    <DownloadSimple size={14} className="mr-1" />
                    Import
                  </Button>
                ) : null}
              </div>
            </SettingsRow>
            <div className="px-4 py-2">
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setShowBaseUrl(!showBaseUrl)}
              >
                {showBaseUrl ? "Hide" : "Show"} Base URL
              </button>
              {showBaseUrl ? (
                <SettingsRow title="">
                  <Input
                    value={settings.opencodeZenBaseUrl}
                    placeholder="https://opencode.ai/zen/v1"
                    onChange={(event) => onOpencodeZenBaseUrlChange(event.target.value)}
                  />
                </SettingsRow>
              ) : null}
            </div>
          </div>
        ) : usesLiteLlmProxy ? (
          <SettingsRow title="Proxy URL" description={settings.provider === "github-copilot" ? "GitHub Copilot through a LiteLLM proxy." : "Point Construct at your LiteLLM proxy instance."}>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Input value={settings.liteLlmBaseUrl} placeholder="http://localhost:4000/v1" onChange={(event) => onLiteLlmBaseUrlChange(event.target.value)} />
              <Input type="password" value={settings.liteLlmApiKey} placeholder="API key optional" onChange={(event) => onLiteLlmApiKeyChange(event.target.value)} />
            </div>
          </SettingsRow>
        ) : null}

        {/* Managed server — only for litellm */}
        {!usesConstructCloud && settings.provider === "litellm" && onLitellmStart && onLitellmStop ? (
          <SettingsRow
            title="Managed server"
            description={litellmState?.status === "running" ? `Running on port ${litellmState.port} (PID ${litellmState.pid})` : "Start a local LiteLLM proxy that Construct manages."}
          >
            <div className="flex items-center gap-2">
              {litellmState?.status === "running" ? (
                <Button size="small" variant="secondary" onClick={onLitellmStop}>
                  <Square size={12} weight="fill" className="mr-1.5" />
                  Stop
                </Button>
              ) : litellmState?.status === "starting" || litellmState?.status === "stopping" ? (
                <Button size="small" variant="secondary" disabled>
                  <Square size={12} weight="fill" className="mr-1.5" />
                  {litellmState.status === "stopping" ? "Stopping..." : "Starting..."}
                </Button>
              ) : (
                <Button size="small" onClick={onLitellmStart}>
                  <Play size={12} weight="fill" className="mr-1.5" />
                  Start
                </Button>
              )}
              {litellmState?.error ? (
                <span className="text-xs text-destructive">{litellmState.error}</span>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}

        <SettingsRow title="Tavily API key" description="Used by the Flow Research Agent for bounded web research. Stored locally by Construct.">
          <Input
            type="password"
            value={settings.tavilyApiKey}
            placeholder="tvly-..."
            onChange={(event) => onTavilyApiKeyChange(event.target.value)}
          />
        </SettingsRow>

        {/* Model */}
        <SettingsRow
          title="Available models"
          description={modelOptions.length > 0 ? `${modelOptions.length} models loaded from ${providerLabel}` : "Click Refresh to load the full model catalog."}
          control={
            <Button
              variant="secondary"
              size="small"
              disabled={modelsBusy}
              onClick={() => onRefreshModels(activeModelProvider)}
            >
              {modelsBusy ? "Loading..." : "Refresh"}
            </Button>
          }
        />

        <SettingsRow
          title="Global model"
          description="All agents use this unless you override specific features below."
          control={
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-56 text-xs"
                value={globalModel}
                placeholder="model-id"
                onChange={(e) => onGlobalModelChange(e.target.value)}
              />
              <ProviderModelPicker provider={activeModelProvider} value={globalModel} models={baseModels} disabled={modelsBusy || baseModels.length === 0} onChange={onGlobalModelChange} />
            </div>
          }
        />

        {/* Per-feature model overrides — collapsible */}
        <div className="px-4 py-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setShowFeatureModels(!showFeatureModels)}
          >
            {showFeatureModels ? "Hide" : "Show"} per-feature models ({features.length})
          </button>
          {showFeatureModels ? features.map((feature) => (
            <SettingsRow
              key={feature.id}
              title={feature.title}
              description={feature.description}
              control={
                <ProviderModelPicker
                  provider={activeModelProvider}
                  value={feature.model}
                  models={baseModels.some((m) => m.id === feature.model) || !feature.model ? baseModels : [{ id: feature.model, name: feature.model }, ...baseModels]}
                  disabled={modelsBusy}
                  onChange={(model) => onFeatureModelChange(feature.id, model)}
                />
              }
            />
          )) : null}
        </div>

        {/* Save */}
        <SettingsRow
          title="Save AI settings"
          description={modelsError ?? ""}
          control={
            <Button size="small" disabled={aiBusy} onClick={onSave}>
              {aiBusy ? "Saving..." : "Save"}
            </Button>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function normalizeReasoningEffort(value: string): AiSettings["reasoningEffort"] {
  return value === "none"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "auto"
    ? value
    : "auto";
}
