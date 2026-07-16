import { useState, type ReactNode } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { BotIcon, CloudIcon } from "lucide-react";
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
  SettingsSection,
  SettingsToggle
} from "@opaline/ui";

import type { AiSettings, ModelCatalogEntry } from "../../types";
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

type AiProvider = AiSettings["provider"];
type AiSource = AiSettings["source"];
type AiRuntime = AiSettings["runtime"];

export function ConstructAiSettingsSection({
  settings,
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
  onFlowSourceGroundingEnabledChange,
  onOpenAiApiKeyChange,
  onOpenAiBaseUrlChange,
  onOpenRouterApiKeyChange,
  onOpenRouterBaseUrlChange,
  onTavilyApiKeyChange,
  onOpenRouterModelChange,
  onOpenAiModelChange,
  onOpencodeZenApiKeyChange,
  onOpencodeZenBaseUrlChange,
  onOpencodeZenModelChange,
  onConstructCloudBaseUrlChange,
  onConstructCloudAccessTokenChange,
  onConstructCloudModelChange,
  onSave,
  onImportOpencodeAuth,
  allowConstructCloudEndpointEditing = false
}: {
  settings: AiSettings;
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
  onFlowSourceGroundingEnabledChange?: (enabled: boolean) => void;
  onOpenAiApiKeyChange: (apiKey: string) => void;
  onOpenAiBaseUrlChange: (baseUrl: string) => void;
  onOpenRouterApiKeyChange: (apiKey: string) => void;
  onOpenRouterBaseUrlChange: (baseUrl: string) => void;
  onTavilyApiKeyChange: (apiKey: string) => void;
  onOpenRouterModelChange: (model: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onOpencodeZenApiKeyChange: (apiKey: string) => void;
  onOpencodeZenBaseUrlChange: (baseUrl: string) => void;
  onOpencodeZenModelChange: (model: string) => void;
  onConstructCloudBaseUrlChange: (baseUrl: string) => void;
  onConstructCloudAccessTokenChange: (accessToken: string) => void;
  onConstructCloudModelChange: (model: string) => void;
  onSave: () => void;
  onImportOpencodeAuth?: () => Promise<string | null>;
  allowConstructCloudEndpointEditing?: boolean;
}) {
  const [cloudUsage, setCloudUsage] = useState<any>(null);
  const usesConstructCloud = settings.source === "construct-cloud";

  const recommended = settings.provider === "openrouter"
    ? RECOMMENDED_OPENROUTER_MODELS
    : settings.provider === "opencode-zen"
      ? RECOMMENDED_OPENCODE_ZEN_MODELS
      : RECOMMENDED_OPENAI_MODELS;

  const globalModel = usesConstructCloud
    ? settings.constructCloudModel
    : settings.provider === "openrouter"
    ? settings.openRouterModel
    : settings.provider === "opencode-zen"
      ? settings.opencodeZenModel
      : settings.openAiModel;

  const onGlobalModelChange = usesConstructCloud
    ? onConstructCloudModelChange
    : settings.provider === "openrouter"
    ? onOpenRouterModelChange
    : settings.provider === "opencode-zen"
      ? onOpencodeZenModelChange
      : onOpenAiModelChange;

  const baseModels = modelOptions.length > 0 ? modelOptions : usesConstructCloud ? [] : recommended;
  const constructCloudModelAvailable = !usesConstructCloud
    || modelOptions.some((model) => model.id === globalModel);
  const canSave = !aiBusy && constructCloudModelAvailable;

  const providerLabel = usesConstructCloud
    ? "Construct Cloud"
    : settings.provider === "openrouter"
    ? "OpenRouter"
    : settings.provider === "opencode-zen"
      ? "OpenCode Zen"
      : "OpenAI";

  return (
    <>
      <SettingsSection title="Construct Cloud" description="Account connection and optional Construct Cloud model access.">
        <SettingsCard>
          <SettingsRow title="Account" description="Manage the signed-in account endpoint and Construct Cloud token.">
            <ConstructCloudAccountPanel
              baseUrl={settings.constructCloudBaseUrl}
              accessToken={settings.constructCloudAccessToken}
              disabled={aiBusy}
              allowEndpointEditing={allowConstructCloudEndpointEditing}
              onBaseUrlChange={onConstructCloudBaseUrlChange}
              onAccessTokenChange={onConstructCloudAccessTokenChange}
              onUsageLoaded={setCloudUsage}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {cloudUsage ? (
        <SettingsSection title="General usage limits">
          <SettingsCard>
            <UsageRow label="5 hour usage limit" window={cloudUsage.windows.five_hour_all} isFiveHour={true} />
            <UsageRow label="Weekly usage limit" window={cloudUsage.windows.weekly_all} isFiveHour={false} />
            {cloudUsage.windows.weekly_expensive ? (
              <UsageRow label="Expensive models limit" window={cloudUsage.windows.weekly_expensive} isFiveHour={false} />
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Runtime">
        <SettingsCard>
          <SettingsRow
            title="Concept Firewall"
            description="Project safeguards to prevent undesired behaviors."
            control={
              <SettingsToggle
                checked={settings.conceptFirewallEnabled !== false}
                onCheckedChange={(checked) => onConceptFirewallEnabledChange?.(checked)}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Model Source">
        <SettingsCard>
          <SettingsRow
            title="Source"
            description="BYOK uses your local provider key. Construct Cloud uses your Construct account."
            control={
              <Select
                value={settings.source}
                onValueChange={(value) => onSourceChange(value === "construct-cloud" ? "construct-cloud" : "byok")}
              >
                <SelectTrigger className="h-[34px] w-44 text-xs">
                  <SelectValue placeholder="Select source">
                    {settings.source === "construct-cloud" ? "Construct Cloud" : "BYOK"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="byok">BYOK</SelectItem>
                  <SelectItem value="construct-cloud">Construct Cloud</SelectItem>
                </SelectContent>
              </Select>
            }
          />

          {!usesConstructCloud ? (
            <SettingsRow
              title="Provider"
              description="The BYOK provider for the Construct agent."
              control={
                <Select
                  value={settings.provider}
                  onValueChange={(value) => onProviderChange(
                    value === "openrouter" || value === "opencode-zen" ? value : "openai"
                  )}
                >
                  <SelectTrigger className="h-[34px] w-44 text-xs">
                    <SelectValue placeholder="Select provider">
                      {settings.provider === "openai"
                        ? "OpenAI"
                        : settings.provider === "openrouter"
                        ? "OpenRouter"
                        : settings.provider === "opencode-zen"
                        ? "OpenCode Zen"
                        : settings.provider}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="opencode-zen">OpenCode Zen</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          ) : (
            <SettingsRow
              title="Construct Cloud"
              description={settings.constructCloudAccessToken ? "Construct Cloud token is configured." : "Mint or paste a Construct Cloud token above."}
              control={<CloudIcon size={16} className="text-muted-foreground" />}
            />
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Credentials">
        <SettingsCard>
          {!usesConstructCloud && settings.provider === "openai" ? (
            <>
              <SettingsRow title="OpenAI API key" description="Stored locally by Construct.">
                <Input
                  type="password"
                  value={settings.openAiApiKey}
                  placeholder="sk-..."
                  className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
                  onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow title="OpenAI base URL">
                <Input
                  value={settings.openAiBaseUrl}
                  placeholder="https://api.openai.com/v1"
                  className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
                  onChange={(event) => onOpenAiBaseUrlChange(event.target.value)}
                />
              </SettingsRow>
            </>
          ) : null}

          {!usesConstructCloud && settings.provider === "openrouter" ? (
            <>
              <SettingsRow title="OpenRouter API key" description="Stored locally by Construct.">
                <Input
                  type="password"
                  value={settings.openRouterApiKey}
                  placeholder="sk-or-..."
                  className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
                  onChange={(event) => onOpenRouterApiKeyChange(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow title="OpenRouter base URL">
                <Input
                  value={settings.openRouterBaseUrl}
                  placeholder="https://openrouter.ai/api/v1"
                  className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
                  onChange={(event) => onOpenRouterBaseUrlChange(event.target.value)}
                />
              </SettingsRow>
            </>
          ) : null}

          {!usesConstructCloud && settings.provider === "opencode-zen" ? (
            <>
              <SettingsRow title="OpenCode Zen API key" description="Get yours at opencode.ai/auth">
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="password"
                    className="flex-1 bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 transition-all"
                    value={settings.opencodeZenApiKey}
                    placeholder="sk-..."
                    onChange={(event) => onOpencodeZenApiKeyChange(event.target.value)}
                  />
                  {onImportOpencodeAuth ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Import API key from opencode CLI auth file"
                      className="bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border/80 font-medium text-xs px-3.5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer flex items-center shrink-0"
                      onClick={() => { void onImportOpencodeAuth(); }}
                    >
                      <DownloadSimple size={14} className="mr-1.5" />
                      Import
                    </Button>
                  ) : null}
                </div>
              </SettingsRow>
              <SettingsRow title="OpenCode Zen base URL">
                <Input
                  value={settings.opencodeZenBaseUrl}
                  placeholder="https://opencode.ai/zen/v1"
                  className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
                  onChange={(event) => onOpencodeZenBaseUrlChange(event.target.value)}
                />
              </SettingsRow>
            </>
          ) : null}

          <SettingsRow title="Tavily API key" description="Used by the Flow Research Agent for bounded web research. Stored locally by Construct.">
            <Input
              type="password"
              value={settings.tavilyApiKey}
              placeholder="tvly-..."
              className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] px-3 py-2 w-full transition-all mt-1"
              onChange={(event) => onTavilyApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Models">
        <SettingsCard>
          <SettingsRow
            title="Available models"
            description={modelsBusy
              ? `Loading ${providerLabel} models...`
              : modelOptions.length > 0
                ? `${modelOptions.length} models loaded from ${providerLabel}`
                : usesConstructCloud
                  ? "Construct Cloud models load automatically after the Cloud source is selected."
                  : "Provider models load automatically when credentials are configured."}
          />

          <SettingsRow
            title="Construct agent model"
            description={usesConstructCloud && !constructCloudModelAvailable
              ? "This Construct Cloud model is not available. Choose one from the loaded catalog."
              : "The single model used by Construct agent flows."}
            control={
              <ModelSelectionControl
                disabled={modelsBusy}
                model={globalModel}
                models={baseModels}
                providerLabel={providerLabel}
                readOnlyCatalog={usesConstructCloud}
                onModelChange={onGlobalModelChange}
              />
            }
          />

          <SettingsRow
            title="Save AI settings"
            description={modelsError ?? ""}
            control={
              <Button
                size="sm"
                disabled={!canSave}
                className="bg-primary hover:bg-primary/95 text-primary-foreground disabled:bg-muted disabled:text-muted-foreground font-medium text-xs px-5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer border-none"
                onClick={onSave}
              >
                {aiBusy ? "Saving..." : "Save"}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Configuration">
        <SettingsCard>
          <SettingsRow
            title="Edit configuration file"
            description="Directly open and modify the raw construct.config.json file in your system file explorer."
            control={
              <Button
                variant="secondary"
                size="sm"
                className="bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border/80 font-medium text-xs px-3.5 py-1.5 h-[34px] rounded-lg transition-colors cursor-pointer"
                onClick={async () => {
                  try {
                    await window.constructProjects.openConfigFile();
                  } catch (err) {
                    console.error("Failed to open configuration file:", err);
                  }
                }}
              >
                {window.construct?.getRuntimeInfo()?.platform === "darwin"
                  ? "Open in Finder"
                  : window.construct?.getRuntimeInfo()?.platform === "win32"
                  ? "Open in Explorer"
                  : "Open in File Manager"}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function ModelSelectionControl({
  disabled,
  model,
  models,
  providerLabel,
  readOnlyCatalog,
  onModelChange
}: {
  disabled: boolean;
  model: string;
  models: ModelCatalogEntry[];
  providerLabel: string;
  readOnlyCatalog: boolean;
  onModelChange: (model: string) => void;
}) {
  const selectedModel = models.find((entry) => entry.id === model);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {!readOnlyCatalog ? (
        <Input
          className="bg-background border-border hover:border-border/80 focus-visible:ring-2 focus-visible:ring-ring/30 text-foreground placeholder-muted-foreground/60 rounded-lg text-xs h-[34px] w-56 px-3 py-1.5"
          value={model}
          placeholder="model-id"
          onChange={(event) => onModelChange(event.target.value)}
        />
      ) : null}
      <Select
        value={selectedModel?.id ?? ""}
        onValueChange={(value) => {
          if (value) onModelChange(value);
        }}
        disabled={disabled || models.length === 0}
      >
        <SelectTrigger
          className="h-[34px] min-w-[14rem] max-w-[22rem] rounded-lg border-border bg-background text-xs"
          title={`Choose ${providerLabel} model`}
        >
          <BotIcon size={14} className="text-muted-foreground" />
          <SelectValue placeholder={disabled ? "Loading models..." : "Choose model"} />
        </SelectTrigger>
        <SelectContent align="end" className="max-h-80 min-w-[20rem]">
          {models.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{entry.name || entry.id}</span>
                <span className="truncate text-[11px] text-muted-foreground">{entry.id}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}



function CompactChoiceGroup<T extends string>({
  onChange,
  options,
  value
}: {
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
  value: T;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 border border-border/60">
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`h-[28px] rounded-md px-3 text-xs font-semibold transition-all duration-150 cursor-pointer ${
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground bg-transparent"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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

type CloudUsageWindow = {
  windowStart: string;
  windowEnd: string;
  resetAt?: string;
  usedUnits: number;
  reservedUnits: number;
  limitUnits: number;
  remainingUnits: number;
  percentage: number;
};

function formatResetLabel(resetAt: string, isFiveHour: boolean): string {
  const date = new Date(resetAt);
  if (isNaN(date.getTime())) return "";

  if (isFiveHour) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `Resets ${hours}:${minutes}`;
  } else {
    const day = date.getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[date.getMonth()];
    return `Resets ${day} ${month}`;
  }
}

function UsageRow({ label, window, isFiveHour }: { label: string; window: CloudUsageWindow; isFiveHour: boolean }) {
  const remainingPercent = Math.min(100, Math.max(0, 100 - window.percentage));
  const resetAt = window.resetAt ?? window.windowEnd;
  const resetLabel = formatResetLabel(resetAt, isFiveHour);

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground mt-0.5">{resetLabel}</span>
      </div>
      <div className="flex items-center shrink-0">
        <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden mr-3">
          <div
            className="h-full bg-foreground transition-all duration-300"
            style={{ width: `${remainingPercent}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
          {Math.round(remainingPercent)}% left
        </span>
      </div>
    </div>
  );
}
