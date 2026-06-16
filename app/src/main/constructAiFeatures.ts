import type { StoredAiSettings } from "./constructAiSettings";

export type ConstructAiFeatureId =
  | "verification"
  | "construct-interact"
  | "authoring-review"
  | "selection-explain"
  | "code-explain";

export type ConstructAiFeature = {
  id: ConstructAiFeatureId;
  title: string;
  description: string;
  defaultOpenAiModel: string;
  defaultOpenRouterModel: string;
};

export const constructAiFeatures: ConstructAiFeature[] = [
  {
    id: "construct-interact",
    title: "Construct Interact",
    description: "Evaluates text answers, asks grounded follow-ups, and updates learner memory.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "verification",
    title: "Verify work",
    description: "Checks learner code against the tape rubric and evidence.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "authoring-review",
    title: "Review tapes",
    description: "Suggests focused improvements for tape structure and teaching quality.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "selection-explain",
    title: "Explain selection",
    description: "Connects highlighted code to the current project and optional web context.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash"
  },
  {
    id: "code-explain",
    title: "Inline code help",
    description: "Explains the active code line in-place while you read or edit.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "deepseek/deepseek-v4-flash"
  }
];

export function modelForAiFeature(settings: StoredAiSettings, featureId: ConstructAiFeatureId): string {
  const feature = constructAiFeatures.find((item) => item.id === featureId);
  const saved = settings.featureModels?.[featureId]?.trim();
  if (saved) return saved;

  const globalModel = settings.provider === "openrouter"
    ? settings.openRouterModel?.trim()
    : settings.openAiModel?.trim();

  if (globalModel) return globalModel;

  if (settings.provider === "openrouter") {
    return feature?.defaultOpenRouterModel ?? settings.openRouterModel;
  }

  return feature?.defaultOpenAiModel ?? settings.openAiModel;
}

export function featureSettingsView(settings: StoredAiSettings) {
  return constructAiFeatures.map((feature) => ({
    ...feature,
    model: modelForAiFeature(settings, feature.id)
  }));
}
