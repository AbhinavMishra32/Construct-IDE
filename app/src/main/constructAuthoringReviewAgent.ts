import { z } from "zod";
import { createConstructAgentRuntime } from "./constructAgentRuntime";

export const CONSTRUCT_AUTHORING_REVIEW_AGENT_ID = "construct-authoring-review-agent";

const AuthoringSuggestionSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
  category: z.enum(["teaching-order", "missing-concept", "bookish-support", "recall-too-hard", "code-step-too-large", "missing-reference", "missing-doc-link", "git-milestone", "other"]),
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
  const runtime = createConstructAgentRuntime();
  const output = await runtime.generateStructured({
    id: CONSTRUCT_AUTHORING_REVIEW_AGENT_ID,
    name: "Construct Authoring Review Agent",
    purpose: "authoring review",
    instructions: [
      "You review the teaching quality of .construct project tapes after compiler validation succeeds.",
      "Do not repair grammar, nesting, missing ::end markers, or protocol aliases; the compiler owns those.",
      "Use only the compact project view, diagnostics, and focused snippets supplied.",
      "Never request or rewrite the entire tape.",
      "Propose small, precise improvements for teaching order, concepts, support, recall difficulty, code-step size, references, docs links, and git milestones.",
      "Respect the tape-0.3 layer model: guide.* is learner-facing, verify internals stay nested under recall, and file navigation uses [[file:...]] references.",
      "Do not invent line numbers. Omit affectedLines unless a supplied snippet or diagnostic makes them explicit.",
      "Every suggestion requires user approval. Return no more than twelve high-signal suggestions."
    ].join("\n"),
    prompt: buildPrompt(input),
    schema: AuthoringReviewSchema,
    maxRetries: 1
  });

  return output.suggestions;
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
