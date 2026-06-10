import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { z } from "zod";

export const CONSTRUCT_AUTHORING_REVIEW_AGENT_ID = "construct-authoring-review-agent";

const AuthoringSuggestionSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  category: z.enum(["teaching-order", "missing-concept", "bookish-support", "recall-too-hard", "ghost-too-large", "missing-reference", "missing-doc-link", "git-milestone", "other"]),
  title: z.string().min(1),
  reason: z.string().min(1),
  affectedLines: z.array(z.number().int().positive()).optional(),
  suggestedFixSummary: z.string().min(1),
  requiresUserApproval: z.boolean()
});

const AuthoringReviewSchema = z.object({
  suggestions: z.array(AuthoringSuggestionSchema).max(12)
});

export type AuthoringSuggestion = z.infer<typeof AuthoringSuggestionSchema>;

export type AuthoringReviewInput = {
  projectView: unknown;
  diagnostics: Array<{ code: string; severity: string; message: string; line: number; blockId?: string }>;
  snippets: Array<{ label: string; startLine: number; text: string }>;
  spec: string;
};

export async function runConstructAuthoringReviewAgent(input: AuthoringReviewInput): Promise<AuthoringSuggestion[]> {
  const agent = new Agent({
    id: CONSTRUCT_AUTHORING_REVIEW_AGENT_ID,
    name: "Construct Authoring Review Agent",
    instructions: [
      "You review the teaching quality of .construct project tapes after compiler validation succeeds.",
      "Do not repair grammar, nesting, missing ::end markers, or protocol aliases; the compiler owns those.",
      "Use only the compact project view, diagnostics, and focused snippets supplied.",
      "Never request or rewrite the entire tape.",
      "Propose small, precise improvements for teaching order, concepts, support, recall difficulty, ghost edit size, references, docs links, and git milestones.",
      "Do not invent line numbers. Omit affectedLines unless a supplied snippet or diagnostic makes them explicit.",
      "Every suggestion requires user approval. Return no more than twelve high-signal suggestions."
    ].join("\n"),
    model: resolveAuthoringModel(),
    maxRetries: 1
  });

  new Mastra({ agents: { [CONSTRUCT_AUTHORING_REVIEW_AGENT_ID]: agent }, logger: false });
  const output = await agent.generate(buildPrompt(input), { structuredOutput: { schema: AuthoringReviewSchema } });
  return AuthoringReviewSchema.parse(output.object).suggestions;
}

function resolveAuthoringModel() {
  const provider = (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase();
  const apiKey = (provider === "openrouter" ? process.env.CONSTRUCT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)?.trim();
  if (!apiKey) throw new Error(provider === "openrouter" ? "OPENROUTER_API_KEY is required for authoring review." : "OPENAI_API_KEY is required for authoring review.");
  return provider === "openrouter"
    ? { providerId: "openrouter", modelId: process.env.CONSTRUCT_OPENROUTER_FAST_MODEL?.trim() || "openai/gpt-5-nano", url: process.env.CONSTRUCT_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1", apiKey }
    : { providerId: "openai", modelId: process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim() || "gpt-5-nano", url: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(), apiKey };
}

function buildPrompt(input: AuthoringReviewInput): string {
  return [
    `Tape spec: ${input.spec}`,
    "",
    "Compact project view:",
    JSON.stringify(input.projectView, null, 2),
    "",
    "Deterministic diagnostics:",
    JSON.stringify(input.diagnostics, null, 2),
    "",
    "Focused source snippets:",
    input.snippets.length > 0 ? input.snippets.map((snippet) => `--- ${snippet.label} (line ${snippet.startLine}) ---\n${snippet.text}`).join("\n\n") : "(none)",
    "",
    "Return focused authoring suggestions only. Grammar repairs are out of scope."
  ].join("\n");
}
