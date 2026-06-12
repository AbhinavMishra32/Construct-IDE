import type { StoredAiSettings } from "./constructAiSettings";

export type ConstructAiFeatureId =
  | "verification"
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
    id: "verification",
    title: "Verify work",
    description: "Checks learner code against the tape rubric and evidence.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "openai/gpt-5-mini"
  },
  {
    id: "authoring-review",
    title: "Review tapes",
    description: "Suggests focused improvements for tape structure and teaching quality.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "openai/gpt-5-mini"
  },
  {
    id: "selection-explain",
    title: "Explain selection",
    description: "Connects highlighted code to the current project and optional web context.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "openai/gpt-5-mini"
  },
  {
    id: "code-explain",
    title: "Inline code help",
    description: "Explains the active code line in-place while you read or edit.",
    defaultOpenAiModel: "gpt-5-mini",
    defaultOpenRouterModel: "openai/gpt-5-mini"
  }
];

export function modelForAiFeature(settings: StoredAiSettings, featureId: ConstructAiFeatureId): string {
  const feature = constructAiFeatures.find((item) => item.id === featureId);
  const saved = settings.featureModels?.[featureId]?.trim();
  if (saved) return saved;

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
