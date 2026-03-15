import { z } from "zod";

export const LearningStyleSchema = z.enum([
  "concept-first",
  "build-first",
  "example-first"
]);

export const ConceptConfidenceSchema = z.enum(["comfortable", "shaky", "new"]);

export const PlanningQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  value: ConceptConfidenceSchema
});

export const PlanningQuestionSchema = z.object({
  id: z.string().min(1),
  conceptId: z.string().min(1),
  category: z.enum(["language", "domain", "workflow"]),
  prompt: z.string().min(1),
  options: z.array(PlanningQuestionOptionSchema).length(3)
});

export const PlanningSessionStartRequestSchema = z.object({
  goal: z.string().min(3),
  learningStyle: LearningStyleSchema.default("concept-first")
});

export const PlanningSessionSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(3),
  normalizedGoal: z.string().min(3),
  learningStyle: LearningStyleSchema,
  detectedLanguage: z.string().min(1),
  detectedDomain: z.string().min(1),
  createdAt: z.string().datetime(),
  questions: z.array(PlanningQuestionSchema)
});

export const PlanningAnswerSchema = z.object({
  questionId: z.string().min(1),
  value: ConceptConfidenceSchema
});

export const ConceptNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["language", "domain", "workflow"]),
  confidence: ConceptConfidenceSchema,
  rationale: z.string().min(1)
});

export const KnowledgeGraphSchema = z.object({
  concepts: z.array(ConceptNodeSchema).min(1),
  strengths: z.array(z.string().min(1)),
  gaps: z.array(z.string().min(1))
});

export const ArchitectureComponentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["component", "skill"]),
  summary: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).default([])
});

export const GeneratedPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["skill", "implementation"]),
  objective: z.string().min(1),
  rationale: z.string().min(1),
  concepts: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(z.string().min(1)).default([]),
  validationFocus: z.array(z.string().min(1)).default([]),
  suggestedFiles: z.array(z.string().min(1)).default([])
});

export const GeneratedProjectPlanSchema = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(3),
  language: z.string().min(1),
  domain: z.string().min(1),
  learningStyle: LearningStyleSchema,
  summary: z.string().min(1),
  architecture: z.array(ArchitectureComponentSchema).min(1),
  knowledgeGraph: KnowledgeGraphSchema,
  steps: z.array(GeneratedPlanStepSchema).min(1),
  suggestedFirstStepId: z.string().min(1)
});

export const PlanningSessionStartResponseSchema = z.object({
  session: PlanningSessionSchema
});

export const PlanningSessionCompleteRequestSchema = z.object({
  sessionId: z.string().min(1),
  answers: z.array(PlanningAnswerSchema).min(1)
});

export const PlanningSessionCompleteResponseSchema = z.object({
  session: PlanningSessionSchema,
  plan: GeneratedProjectPlanSchema
});

export const CurrentPlanningSessionResponseSchema = z.object({
  session: PlanningSessionSchema.nullable(),
  plan: GeneratedProjectPlanSchema.nullable()
});

export type LearningStyle = z.infer<typeof LearningStyleSchema>;
export type ConceptConfidence = z.infer<typeof ConceptConfidenceSchema>;
export type PlanningQuestionOption = z.infer<typeof PlanningQuestionOptionSchema>;
export type PlanningQuestion = z.infer<typeof PlanningQuestionSchema>;
export type PlanningSessionStartRequest = z.infer<typeof PlanningSessionStartRequestSchema>;
export type PlanningSession = z.infer<typeof PlanningSessionSchema>;
export type PlanningAnswer = z.infer<typeof PlanningAnswerSchema>;
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;
export type ArchitectureComponent = z.infer<typeof ArchitectureComponentSchema>;
export type GeneratedPlanStep = z.infer<typeof GeneratedPlanStepSchema>;
export type GeneratedProjectPlan = z.infer<typeof GeneratedProjectPlanSchema>;
export type PlanningSessionStartResponse = z.infer<typeof PlanningSessionStartResponseSchema>;
export type PlanningSessionCompleteRequest = z.infer<typeof PlanningSessionCompleteRequestSchema>;
export type PlanningSessionCompleteResponse = z.infer<typeof PlanningSessionCompleteResponseSchema>;
export type CurrentPlanningSessionResponse = z.infer<typeof CurrentPlanningSessionResponseSchema>;
