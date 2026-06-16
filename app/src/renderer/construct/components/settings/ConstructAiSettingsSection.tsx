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
  onOpenRouterModelChange,
  onOpenAiModelChange,
  onRefreshModels,
  onFeatureModelChange,
  onSave
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
  onOpenRouterModelChange: (model: string) => void;
  onOpenAiModelChange: (model: string) => void;
  onRefreshModels: (provider: AiProvider) => void;
  onFeatureModelChange: (featureId: string, model: string) => void;
  onSave: () => void;
}) {
  const recommended = settings.provider === "openrouter"
    ? RECOMMENDED_OPENROUTER_MODELS
    : RECOMMENDED_OPENAI_MODELS;

  const globalModel = settings.provider === "openrouter"
    ? settings.openRouterModel
    : settings.openAiModel;

  const onGlobalModelChange = settings.provider === "openrouter"
    ? onOpenRouterModelChange
    : onOpenAiModelChange;

  const baseModels = modelOptions.length > 0 ? modelOptions : recommended;

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
            onValueChange={(value) => onProviderChange(value === "openrouter" ? "openrouter" : "openai")}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {settings.provider === "openai" ? (
          <SettingsRow title="OpenAI API Key" description="Stored locally by Construct and used by packaged releases.">
            <Input
              type="password"
              value={settings.openAiApiKey}
              placeholder="sk-..."
              onChange={(event) => onOpenAiApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        ) : (
          <SettingsRow title="OpenRouter API Key" description="Stored locally by Construct and used by packaged releases.">
            <Input
              type="password"
              value={settings.openRouterApiKey}
              placeholder="sk-or-..."
              onChange={(event) => onOpenRouterApiKeyChange(event.target.value)}
            />
          </SettingsRow>
        )}

        {settings.provider === "openai" ? (
          <SettingsRow title="OpenAI Base URL" description="Stored in Construct config and used for OpenAI-compatible requests.">
            <Input
              value={settings.openAiBaseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(event) => onOpenAiBaseUrlChange(event.target.value)}
            />
          </SettingsRow>
        ) : (
          <SettingsRow title="OpenRouter Base URL" description="Stored in Construct config and used for OpenRouter-compatible requests.">
            <Input
              value={settings.openRouterBaseUrl}
              placeholder="https://openrouter.ai/api/v1"
              onChange={(event) => onOpenRouterBaseUrlChange(event.target.value)}
            />
          </SettingsRow>
        )}

        <SettingsRow
          title="Available models"
          description={modelOptions.length > 0 ? `${modelOptions.length} models loaded from ${settings.provider === "openrouter" ? "OpenRouter" : "OpenAI"}` : "Recommended models shown. Click Refresh to load the full catalog from your provider."}
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
          description="Type any model ID. All agents use this unless you override a specific feature below."
          control={
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-56 text-xs"
                value={globalModel}
                placeholder="provider/model-name"
                onChange={(e) => onGlobalModelChange(e.target.value)}
              />
              <Select
                value=""
                disabled={modelsBusy}
                onValueChange={(model) => model && onGlobalModelChange(model)}
              >
                <SelectTrigger className="h-8 w-auto px-2 text-xs">
                  <SelectValue placeholder="Pick..." />
                </SelectTrigger>
                <SelectContent>
                  {baseModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        {features.map((feature) => (
          <SettingsRow
            key={feature.id}
            title={feature.title}
            description={feature.description}
            control={
              <Select
                value={feature.model ?? ""}
                disabled={modelsBusy}
                onValueChange={(model) => model && onFeatureModelChange(feature.id, model)}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder={feature.model || "Select model"} />
                </SelectTrigger>
                <SelectContent>
                  {baseModels.some((m) => m.id === feature.model)
                    ? baseModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))
                    : [
                        <SelectItem key={feature.model ?? ""} value={feature.model ?? ""}>
                          {feature.model || "Select model"}
                        </SelectItem>,
                        ...baseModels.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))
                      ]}
                </SelectContent>
              </Select>
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
