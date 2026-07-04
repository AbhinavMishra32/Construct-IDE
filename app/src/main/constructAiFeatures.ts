import type { StoredAiSettings } from "./constructAiSettings";

export type ConstructAiFeatureId =
  | "verification"
  | "construct-interact"
  | "construct-flow"
  | "authoring-review"
  | "selection-explain"
  | "code-explain";

export type ConstructAiFeature = {
  id: ConstructAiFeatureId;
  title: string;
  description: string;
  defaultOpenAiModel: string;
  defaultOpenRouterModel: string;
  defaultOpenCodeZenModel: string;
  defaultGithubCopilotModel: string;
  defaultLiteLlmModel: string;
  defaultConstructCloudModel: string;
};

export const constructAiFeatures: ConstructAiFeature[] = [
  {
    id: "construct-interact",
    title: "Construct Interact",
    description: "Evaluates text answers, asks grounded follow-ups, and updates learner memory.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "construct-flow",
    title: "Construct Flow",
    description: "Guides open-ended project work with workspace tools, memory, and practice tasks.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "verification",
    title: "Verify work",
    description: "Checks learner code against the tape rubric and evidence.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "authoring-review",
    title: "Review tapes",
    description: "Suggests focused improvements for tape structure and teaching quality.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "selection-explain",
    title: "Explain selection",
    description: "Connects highlighted code to the current project and optional web context.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "code-explain",
    title: "Inline code help",
    description: "Explains the active code line in-place while you read or edit.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash",
    defaultOpenCodeZenModel: "gpt-5.1-codex",
    defaultGithubCopilotModel: "github_copilot/gpt-4",
    defaultLiteLlmModel: "openai/gpt-5-mini",
    defaultConstructCloudModel: "deepseek/deepseek-v4-flash"
  }
];

export function isModelValidForProvider(modelId: string, provider: string): boolean {
  const model = modelId.trim();
  if (!model) return false;

  if (provider === "openai") {
    return !model.includes("/") && (
      model.startsWith("gpt-") ||
      model.startsWith("o1-") ||
      model.startsWith("o3-") ||
      model.startsWith("chatgpt-")
    );
  }

  if (provider === "openrouter" || provider === "construct-cloud") {
    return model.includes("/");
  }

  if (provider === "github-copilot") {
    return model.startsWith("github");
  }

  if (provider === "opencode-zen") {
    if (model.includes("/")) {
      return model === "deepseek/deepseek-v4-flash";
    }
    return (
      model.startsWith("gpt-") ||
      model.startsWith("claude-") ||
      model.startsWith("gemini-") ||
      model.startsWith("grok-") ||
      model.startsWith("deepseek-") ||
      model.startsWith("glm-") ||
      model.startsWith("minimax-") ||
      model.startsWith("kimi-") ||
      model.startsWith("qwen-") ||
      model.startsWith("mimo-") ||
      model.startsWith("nemotron-") ||
      model.startsWith("north-") ||
      model === "big-pickle"
    );
  }

  return true;
}

export function modelForAiFeature(settings: StoredAiSettings, featureId: ConstructAiFeatureId): string {
  const feature = constructAiFeatures.find((item) => item.id === featureId);
  const provider = settings.source === "construct-cloud" ? "construct-cloud" : settings.provider;
  const globalModel = globalModelForProvider(settings);

  if (globalModel && isModelValidForProvider(globalModel, provider)) {
    return globalModel;
  }

  const legacySaved = settings.featureModels?.[featureId]?.trim();
  if (legacySaved && isModelValidForProvider(legacySaved, provider)) {
    return legacySaved;
  }

  if (settings.source === "construct-cloud") {
    return feature?.defaultConstructCloudModel ?? settings.constructCloudModel;
  }

  if (settings.provider === "openrouter") {
    return feature?.defaultOpenRouterModel ?? settings.openRouterModel;
  }

  if (settings.provider === "opencode-zen") {
    return feature?.defaultOpenCodeZenModel ?? settings.opencodeZenModel;
  }

  if (settings.provider === "github-copilot") {
    return feature?.defaultGithubCopilotModel ?? settings.githubCopilotModel;
  }

  if (settings.provider === "litellm") {
    return feature?.defaultLiteLlmModel ?? settings.liteLlmModel;
  }

  return feature?.defaultOpenAiModel ?? settings.openAiModel;
}

export function featureSettingsView(settings: StoredAiSettings) {
  return constructAiFeatures.map((feature) => ({
    ...feature,
    model: modelForAiFeature(settings, feature.id)
  }));
}

export function globalModelForProvider(settings: StoredAiSettings): string {
  if (settings.source === "construct-cloud") return settings.constructCloudModel?.trim() ?? "";
  if (settings.provider === "openrouter") return settings.openRouterModel?.trim() ?? "";
  if (settings.provider === "opencode-zen") return settings.opencodeZenModel?.trim() ?? "";
  if (settings.provider === "github-copilot") return settings.githubCopilotModel?.trim() ?? "";
  if (settings.provider === "litellm") return settings.liteLlmModel?.trim() ?? "";
  return settings.openAiModel?.trim() ?? "";
}
