import { type ReactNode } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { BotIcon, CloudIcon, Code2Icon, KeyRoundIcon, NetworkIcon, PlugZapIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import {
  Button,
  Input,
  SettingsCard,
  SettingsOptionCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle
} from "@opaline/ui";

import type { AiSettings, ModelCatalogEntry } from "../../types";
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

type AiProvider = AiSettings["provider"];
type AiSource = AiSettings["source"];
type AiRuntime = AiSettings["runtime"];
type ModelLookupProvider = AiProvider | "construct-cloud";
type ChoiceOption<T extends string> = {
  badge?: string;
  description?: string;
  icon?: ReactNode;
  title: string;
  value: T;
};

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
  onRefreshModels,
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
  onRefreshModels: (provider: ModelLookupProvider) => void;
  onSave: () => void;
  onImportOpencodeAuth?: () => Promise<string | null>;
  allowConstructCloudEndpointEditing?: boolean;
}) {
  const usesConstructCloud = settings.source === "construct-cloud";
  const activeModelProvider: ModelLookupProvider = usesConstructCloud ? "construct-cloud" : settings.provider;

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
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Runtime">
        <SettingsCard>
          <SettingsRow title="Agent runtime" description="Runtime adapter used by Construct agents.">
            <CompactChoiceGroup<AiRuntime>
              value={settings.runtime}
              options={[
                { value: "mastra", label: "Mastra" },
                { value: "fxpnt", label: "FXPNT" }
              ]}
              onChange={onRuntimeChange}
            />
          </SettingsRow>
          <SettingsRow title="Thinking effort" description="Auto leaves the provider default unchanged.">
            <CompactChoiceGroup<AiSettings["reasoningEffort"]>
              value={settings.reasoningEffort}
              options={[
                { value: "auto", label: "Auto" },
                { value: "none", label: "None" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" }
              ]}
              onChange={(value) => onReasoningEffortChange(normalizeReasoningEffort(value))}
            />
          </SettingsRow>
          <SettingsRow title="Agent behavior" description="Project safeguards and optional helper surfaces.">
            <div className="grid gap-2 md:grid-cols-3">
              <ToggleTile
                checked={settings.codeGhostEnabled}
                icon={<SparklesIcon size={15} />}
                title="Code Ghost"
                onChange={onCodeGhostEnabledChange}
              />
              <ToggleTile
                checked={settings.conceptFirewallEnabled !== false}
                icon={<ShieldCheckIcon size={15} />}
                title="Concept Firewall"
                onChange={(checked) => onConceptFirewallEnabledChange?.(checked)}
              />
              <ToggleTile
                checked={settings.flowSourceGroundingEnabled !== false}
                icon={<NetworkIcon size={15} />}
                title="Construct research"
                onChange={(checked) => onFlowSourceGroundingEnabledChange?.(checked)}
              />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Model Source">
        <SettingsCard>
          <SettingsRow title="Source" description="BYOK uses your local provider key. Construct Cloud uses your Construct account.">
            <ChoiceGrid<AiSource>
              value={settings.source}
              options={[
                {
                  value: "byok",
                  title: "BYOK",
                  description: "Use a provider key stored locally.",
                  icon: <KeyRoundIcon size={16} />
                },
                {
                  value: "construct-cloud",
                  title: "Construct Cloud",
                  description: "Use Construct account model access.",
                  icon: <CloudIcon size={16} />
                }
              ]}
              onChange={(value) => onSourceChange(value === "construct-cloud" ? "construct-cloud" : "byok")}
            />
          </SettingsRow>

          {!usesConstructCloud ? (
            <SettingsRow title="Provider" description="The BYOK provider for the Construct agent.">
              <ChoiceGrid<AiProvider>
                columns="md:grid-cols-3"
                value={settings.provider}
                options={[
                  { value: "openai", title: "OpenAI", description: "Direct OpenAI-compatible key.", icon: <BotIcon size={16} /> },
                  { value: "openrouter", title: "OpenRouter", description: "Route through OpenRouter.", icon: <PlugZapIcon size={16} /> },
                  { value: "opencode-zen", title: "OpenCode Zen", description: "Use OpenCode Zen auth.", icon: <Code2Icon size={16} /> }
                ]}
                onChange={onProviderChange}
              />
            </SettingsRow>
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
                  onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow title="OpenAI base URL">
                <Input
                  value={settings.openAiBaseUrl}
                  placeholder="https://api.openai.com/v1"
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
                  onChange={(event) => onOpenRouterApiKeyChange(event.target.value)}
                />
              </SettingsRow>
              <SettingsRow title="OpenRouter base URL">
                <Input
                  value={settings.openRouterBaseUrl}
                  placeholder="https://openrouter.ai/api/v1"
                  onChange={(event) => onOpenRouterBaseUrlChange(event.target.value)}
                />
              </SettingsRow>
            </>
          ) : null}

          {!usesConstructCloud && settings.provider === "opencode-zen" ? (
            <>
              <SettingsRow title="OpenCode Zen API key" description="Get yours at opencode.ai/auth">
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
              <SettingsRow title="OpenCode Zen base URL">
                <Input
                  value={settings.opencodeZenBaseUrl}
                  placeholder="https://opencode.ai/zen/v1"
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
              onChange={(event) => onTavilyApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Models">
        <SettingsCard>
          <SettingsRow
            title="Available models"
            description={modelOptions.length > 0 ? `${modelOptions.length} models loaded from ${providerLabel}` : "Search to load the model catalog."}
            control={
              <Button
                variant="secondary"
                size="small"
                disabled={modelsBusy}
                onClick={() => onRefreshModels(activeModelProvider)}
              >
                {modelsBusy ? "Searching..." : "Search models"}
              </Button>
            }
          />

          <SettingsRow
            title="Construct agent model"
            description={usesConstructCloud && !constructCloudModelAvailable
              ? "This Construct Cloud model is not available. Search models and choose one from the returned list."
              : "The single model used by Construct agent flows."}
            control={
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-56 text-xs"
                  value={globalModel}
                  placeholder="model-id"
                  readOnly={usesConstructCloud}
                  onChange={(event) => onGlobalModelChange(event.target.value)}
                />
                <ProviderModelPicker provider={activeModelProvider} value={globalModel} models={baseModels} disabled={modelsBusy || baseModels.length === 0} onChange={onGlobalModelChange} />
              </div>
            }
          />

          <SettingsRow
            title="Save AI settings"
            description={modelsError ?? ""}
            control={
              <Button size="small" disabled={!canSave} onClick={onSave}>
                {aiBusy ? "Saving..." : "Save"}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function ChoiceGrid<T extends string>({
  columns = "md:grid-cols-2",
  onChange,
  options,
  value
}: {
  columns?: string;
  onChange: (value: T) => void;
  options: ChoiceOption<T>[];
  value: T;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((option) => (
        <SettingsOptionCard
          key={option.value}
          title={option.title}
          description={option.description}
          icon={option.icon}
          badge={option.badge}
          selected={value === option.value}
          onClick={() => onChange(option.value)}
        />
      ))}
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
    <div className="inline-flex flex-wrap rounded-lg border bg-muted/20 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm"
          data-active={value === option.value ? "true" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleTile({
  checked,
  icon,
  onChange,
  title
}: {
  checked: boolean;
  icon: ReactNode;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{icon}</span>
        <span className="truncate text-sm font-medium">{title}</span>
      </div>
      <SettingsToggle checked={checked} onCheckedChange={onChange} />
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
