import { Play, Square } from "@phosphor-icons/react";
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

const RECOMMENDED_OPENCODE_MODELS: ModelCatalogEntry[] = [];
const RECOMMENDED_GITHUB_COPILOT_MODELS = [
  { id: "github_copilot/gpt-4", name: "GPT-4", providerId: "github-copilot", providerName: "GitHub Copilot" },
  { id: "github_copilot/gpt-5.1-codex", name: "GPT-5.1 Codex", providerId: "github-copilot", providerName: "GitHub Copilot" }
];
const RECOMMENDED_LITELLM_MODELS = [
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini", providerId: "openai", providerName: "OpenAI" },
  { id: "openrouter/deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "openrouter", providerName: "OpenRouter" },
  { id: "github_copilot/gpt-4", name: "GPT-4", providerId: "github-copilot", providerName: "GitHub Copilot" },
  { id: "opencode/openai/gpt-5", name: "GPT-5", providerId: "opencode", providerName: "OpenCode" }
];

type AiProvider = AiSettings["provider"];
type AiRuntime = AiSettings["runtime"];

export function ConstructAiSettingsSection({
  settings,
  features,
  modelOptions,
  modelsBusy,
  aiBusy,
  modelsError,
  onRuntimeChange,
  onProviderChange,
  onOpenAiApiKeyChange,
  onOpenAiBaseUrlChange,
  onOpenRouterApiKeyChange,
  onOpenRouterBaseUrlChange,
  onLiteLlmApiKeyChange,
  onLiteLlmBaseUrlChange,
  onLiteLlmModelChange,
  onOpenRouterModelChange,
  onOpenAiModelChange,
  onOpenCodeModelChange,
  onGithubCopilotModelChange,
  onRefreshModels,
  onFeatureModelChange,
  onSave,
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
  onProviderChange: (provider: AiProvider) => void;
  onOpenAiApiKeyChange: (apiKey: string) => void;
  onOpenAiBaseUrlChange: (baseUrl: string) => void;
  onOpenRouterApiKeyChange: (apiKey: string) => void;
  onOpenRouterBaseUrlChange: (baseUrl: string) => void;
  onLiteLlmApiKeyChange: (apiKey: string) => void;
  onLiteLlmBaseUrlChange: (baseUrl: string) => void;
  onLiteLlmModelChange: (model: string) => void;
  onOpenRouterModelChange: (model: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onOpenCodeModelChange: (model: string) => void;
  onGithubCopilotModelChange: (model: string) => void;
  onRefreshModels: (provider: AiProvider) => void;
  onFeatureModelChange: (featureId: string, model: string) => void;
  onSave: () => void;
  litellmState?: { status: string; port: number; pid: number | null; error: string | null };
  onLitellmStart?: () => void;
  onLitellmStop?: () => void;
}) {
  const recommended = settings.provider === "openrouter"
    ? RECOMMENDED_OPENROUTER_MODELS
    : settings.provider === "opencode"
      ? RECOMMENDED_OPENCODE_MODELS
      : settings.provider === "github-copilot"
        ? RECOMMENDED_GITHUB_COPILOT_MODELS
        : settings.provider === "litellm"
          ? RECOMMENDED_LITELLM_MODELS
      : RECOMMENDED_OPENAI_MODELS;

  const globalModel = settings.provider === "openrouter"
    ? settings.openRouterModel
    : settings.provider === "opencode"
      ? settings.openCodeModel
      : settings.provider === "github-copilot"
        ? settings.githubCopilotModel
        : settings.provider === "litellm"
          ? settings.liteLlmModel
      : settings.openAiModel;

  const onGlobalModelChange = settings.provider === "openrouter"
    ? onOpenRouterModelChange
    : settings.provider === "opencode"
      ? onOpenCodeModelChange
      : settings.provider === "github-copilot"
        ? onGithubCopilotModelChange
        : settings.provider === "litellm"
          ? onLiteLlmModelChange
      : onOpenAiModelChange;

  const baseModels = modelOptions.length > 0 ? modelOptions : recommended;
  const providerLabel = settings.provider === "openrouter"
    ? "OpenRouter"
    : settings.provider === "opencode"
      ? "OpenCode"
      : settings.provider === "github-copilot"
        ? "GitHub Copilot"
        : settings.provider === "litellm"
          ? "LiteLLM"
      : "OpenAI";
  const usesLiteLlmProxy = settings.provider === "github-copilot" || settings.provider === "opencode" || settings.provider === "litellm";

  return (
    <SettingsSection title="AI">
      <SettingsCard>
        <SettingsRow title="Agent Runtime" description="Choose the runtime adapter used by Construct agents. FXPNT is reserved for the external fxpnt runtime package.">
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

        <SettingsRow title="AI Provider" description="Choose the account Construct uses for AI-assisted features.">
          <Select
            value={settings.provider}
            onValueChange={(value) => onProviderChange(
              value === "openrouter"
              || value === "github-copilot"
              || value === "opencode"
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
              <SelectItem value="github-copilot">GitHub Copilot</SelectItem>
              <SelectItem value="opencode">OpenCode</SelectItem>
              <SelectItem value="litellm">LiteLLM Proxy</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {usesLiteLlmProxy ? (
          <SettingsRow title="LiteLLM Proxy" description="Construct talks to LiteLLM using the OpenAI-compatible proxy API. Configure OpenCode, GitHub Copilot, OpenRouter, and other providers in LiteLLM.">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Input value={settings.liteLlmBaseUrl} placeholder="http://localhost:4000/v1" onChange={(event) => onLiteLlmBaseUrlChange(event.target.value)} />
              <Input type="password" value={settings.liteLlmApiKey} placeholder="LiteLLM key optional" onChange={(event) => onLiteLlmApiKeyChange(event.target.value)} />
            </div>
          </SettingsRow>
        ) : null}

        {settings.provider === "litellm" && onLitellmStart && onLitellmStop ? (
          <SettingsRow
            title="Managed server"
            description={litellmState?.status === "running" ? `Running on port ${litellmState.port} (PID ${litellmState.pid})` : "Start a local LiteLLM proxy that Construct manages for you."}
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

        {settings.provider === "openai" ? (
          <SettingsRow title="OpenAI API Key" description="Stored locally by Construct and used by packaged releases.">
            <Input
              type="password"
              value={settings.openAiApiKey}
              placeholder="sk-..."
              onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        ) : settings.provider === "openrouter" ? (
          <SettingsRow title="OpenRouter API Key" description="Stored locally by Construct and used by packaged releases.">
            <Input
              type="password"
              value={settings.openRouterApiKey}
              placeholder="sk-or-..."
              onChange={(event) => onOpenRouterApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        ) : null}

        {settings.provider === "openai" ? (
          <SettingsRow title="OpenAI Base URL" description="Stored in Construct config and used for OpenAI-compatible requests.">
            <Input
              value={settings.openAiBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(event) => onOpenAiBaseUrlChange(event.target.value)}
            />
          </SettingsRow>
        ) : settings.provider === "openrouter" ? (
          <SettingsRow title="OpenRouter Base URL" description="Stored in Construct config and used for OpenRouter-compatible requests.">
            <Input
              value={settings.openRouterBaseUrl}
              placeholder="https://openrouter.ai/api/v1"
              onChange={(event) => onOpenRouterBaseUrlChange(event.target.value)}
            />
          </SettingsRow>
        ) : null}

        <SettingsRow
          title="Available models"
          description={modelOptions.length > 0 ? `${modelOptions.length} models loaded from ${providerLabel}` : usesLiteLlmProxy ? "Click Refresh to load configured models from LiteLLM." : "Recommended models shown. Click Refresh to load the full catalog from your provider."}
          control={
            <Button
              variant="secondary"
              size="small"
              disabled={modelsBusy}
              onClick={() => onRefreshModels(settings.provider)}
            >
              {modelsBusy ? "Loading..." : "Refresh"}
            </Button>
          }
        />

        <SettingsRow
          title="Global model"
          description={usesLiteLlmProxy ? "Model IDs come from LiteLLM, for example github_copilot/gpt-4 or an opencode/* route." : "Type any model ID. All agents use this unless you override a specific feature below."}
          control={
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-56 text-xs"
                value={globalModel}
                placeholder={usesLiteLlmProxy ? "provider/model-name" : "provider/model-name"}
                onChange={(e) => onGlobalModelChange(e.target.value)}
              />
              <ProviderModelPicker provider={settings.provider} value={globalModel} models={baseModels} disabled={modelsBusy || baseModels.length === 0} onChange={onGlobalModelChange} />
            </div>
          }
        />

        {features.map((feature) => (
          <SettingsRow
            key={feature.id}
            title={feature.title}
            description={feature.description}
            control={
              <ProviderModelPicker
                provider={settings.provider}
                value={feature.model}
                models={baseModels.some((m) => m.id === feature.model) || !feature.model ? baseModels : [{ id: feature.model, name: feature.model }, ...baseModels]}
                disabled={modelsBusy}
                onChange={(model) => onFeatureModelChange(feature.id, model)}
              />
            }
          />
        ))}

        <SettingsRow
          title="Save AI settings"
          description={modelsError ?? "Feature model choices are saved locally and used by packaged builds."}
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
