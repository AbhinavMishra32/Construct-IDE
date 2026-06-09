import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { z } from "zod";

export const CONSTRUCT_VERIFIER_AGENT_ID = "construct-verifier-agent";
export const CONSTRUCT_VERIFIER_AGENT_NAME = "Construct Verifier Agent";

const VerificationResultSchema = z.object({
  status: z.enum(["pass", "fail", "almost"]).optional(),
  passed: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  suggestion: z.string().optional(),
  relatedConceptIds: z.array(z.string().min(1)).optional()
});

export type VerificationLogEntry = {
  at: string;
  status: "pending" | "running" | "done" | "failed" | "warning";
  message: string;
  detail?: string;
};

export type VerificationResult = z.infer<typeof VerificationResultSchema> & {
  logs?: VerificationLogEntry[];
};

export type VerifierInput = {
  goal: string;
  rubric: string;
  task: string;
  support: string;
  references: Array<{
    id: string;
    title: string;
    body: string;
  }>;
  concepts?: Array<{
    id: string;
    title: string;
    summary: string;
    why: string;
    example: string;
  }>;
  savedKnowledge?: Array<{
    id: string;
    title: string;
    summary: string;
    why: string;
    example: string;
  }>;
  files: Array<{
    path: string;
    content: string;
  }>;
  terminalCommand?: string;
  terminalOutput?: string;
  messages: {
    success: string;
    failure: string;
  };
};

export async function runConstructVerifierAgent(input: VerifierInput): Promise<VerificationResult> {
  const model = resolveVerifierModel();
  const agent = new Agent({
    id: CONSTRUCT_VERIFIER_AGENT_ID,
    name: CONSTRUCT_VERIFIER_AGENT_NAME,
    instructions: [
      "You are the Construct runtime verifier.",
      "You judge whether a learner achieved the engineering outcome described by the .construct verification contract.",
      "You analyze evidence only: task, support text, reference cards, listed files, terminal command, terminal output, goal, and rubric.",
      "When concept cards or saved knowledge are supplied, use them to explain the missing concept precisely, but never use them as proof that the code is correct.",
      "You do not modify files, suggest broad rewrites, or invent evidence.",
      "Do not pass just because output contains a magic string.",
      "Pass only when the files and runtime evidence satisfy the rubric.",
      "If evidence is missing or ambiguous, return passed=false with confidence=low.",
      "Use status=almost when the learner is close but one concrete requirement is missing.",
      "Keep passed=true only when status=pass.",
      "Give one concrete next suggestion on failure or almost."
    ].join("\n"),
    model,
    maxRetries: 1
  });

  new Mastra({
    agents: {
      [CONSTRUCT_VERIFIER_AGENT_ID]: agent
    },
    logger: false
  });

  const output = await agent.generate(buildVerifierPrompt(input), {
    structuredOutput: {
      schema: VerificationResultSchema
    }
  });

  return VerificationResultSchema.parse(output.object);
}

function resolveVerifierModel() {
  const provider = (process.env.CONSTRUCT_AGENT_PROVIDER ?? "openai").trim().toLowerCase();
  const modelId =
    provider === "openrouter"
      ? process.env.CONSTRUCT_OPENROUTER_FAST_MODEL?.trim() ||
        process.env.CONSTRUCT_OPENROUTER_MODEL?.trim() ||
        "openai/gpt-5-nano"
      : process.env.CONSTRUCT_OPENAI_FAST_MODEL?.trim() ||
        process.env.CONSTRUCT_OPENAI_MODEL?.trim() ||
        "gpt-5-nano";
  const apiKey = (
    provider === "openrouter"
      ? process.env.CONSTRUCT_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY
  )?.trim();

  if (!apiKey) {
    throw new Error(
      provider === "openrouter"
        ? "OPENROUTER_API_KEY or CONSTRUCT_OPENROUTER_API_KEY is required for agent verification."
        : "OPENAI_API_KEY is required for agent verification."
    );
  }

  if (provider === "openrouter") {
    return {
      providerId: "openrouter",
      modelId,
      url: process.env.CONSTRUCT_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      apiKey
    };
  }

  return {
    providerId: "openai",
    modelId,
    url: process.env.CONSTRUCT_OPENAI_BASE_URL?.trim(),
    apiKey
  };
}

function buildVerifierPrompt(input: VerifierInput): string {
  return [
    "Verification goal:",
    input.goal,
    "",
    "Learner task:",
    input.task || "(none)",
    "",
    "Support text:",
    input.support || "(none)",
    "",
    "Reference cards:",
    input.references.length > 0
      ? input.references
          .map((reference) => [
            `# ${reference.id}: ${reference.title}`,
            reference.body
          ].join("\n"))
          .join("\n\n")
      : "(none)",
    "",
    "Concept cards used by this task:",
    formatConcepts(input.concepts ?? []),
    "",
    "Learner saved knowledge cards:",
    formatConcepts(input.savedKnowledge ?? []),
    "",
    "Rubric:",
    input.rubric,
    "",
    "Declared success/failure messages:",
    JSON.stringify(input.messages, null, 2),
    "",
    "Files:",
    input.files.length > 0
      ? input.files
          .map((file) => [
            `--- ${file.path} ---`,
            file.content
          ].join("\n"))
          .join("\n\n")
      : "(none)",
    "",
    "Terminal command:",
    input.terminalCommand || "(none)",
    "",
    "Terminal output:",
    input.terminalOutput || "(none)",
    "",
    "Return a structured result. Evidence entries should name the concrete file/output facts you used.",
    "Set status to pass, fail, or almost. Set passed=true only for pass."
  ].join("\n");
}

function formatConcepts(concepts: NonNullable<VerifierInput["concepts"]>): string {
  if (concepts.length === 0) {
    return "(none)";
  }

  return concepts
    .map((concept) => [
      `# ${concept.id}: ${concept.title}`,
      concept.summary ? `Summary: ${concept.summary}` : "",
      concept.why ? `Why: ${concept.why}` : "",
      concept.example ? `Example:\n${concept.example}` : ""
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}
