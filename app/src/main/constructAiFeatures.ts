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

export function modelForAiFeature(settings: StoredAiSettings, featureId: ConstructAiFeatureId): string {
  const feature = constructAiFeatures.find((item) => item.id === featureId);
  const saved = settings.featureModels?.[featureId]?.trim();
  if (saved) return saved;

  const globalModel = globalModelForProvider(settings);

  if (globalModel) return globalModel;

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
