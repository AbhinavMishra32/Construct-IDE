import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  buildDefaultCourseCreatorPolicy,
  type CourseCreatorPolicy
} from "./creationKernel";

export const CREATION_AGENT_ID = "construct-creation-agent";
export const CREATION_AGENT_NAME = "Construct Creation Agent";

export type CreationAgentToolId =
  | "lock-artifact"
  | "scope-course"
  | "research-course"
  | "plan-course"
  | "generate-project"
  | "author-lessons"
  | "validate-project"
  | "materialize-workspace";

export type CreationAgentToolDescriptor = {
  id: CreationAgentToolId;
  label: string;
  description: string;
};

export type CreationAgentEventPayload = {
  agentId: typeof CREATION_AGENT_ID;
  agentName: typeof CREATION_AGENT_NAME;
  mastra: true;
  tool: CreationAgentToolId;
  toolLabel: string;
  thinking: boolean;
  traceKind: "creation-agent-tool";
};

export const CREATION_AGENT_TOOL_DESCRIPTORS: CreationAgentToolDescriptor[] = [
  {
    id: "lock-artifact",
    label: "Lock artifact",
    description: "Pin the exact thing being built so the course cannot drift into a tutorial-friendly substitute."
  },
  {
    id: "scope-course",
    label: "Scope course",
    description: "Choose project size, first slice, pacing, and whether outside research is needed."
  },
  {
    id: "research-course",
    label: "Research course",
    description: "Collect only the references needed to keep the project and validation honest."
  },
  {
    id: "plan-course",
    label: "Plan course",
    description: "Design the progressive build path from the locked artifact and course creator policy."
  },
  {
    id: "generate-project",
    label: "Generate project",
    description: "Draft the solved artifact, learner files, step metadata, and hidden validation surfaces."
  },
  {
    id: "author-lessons",
    label: "Author lessons",
    description: "Teach the exact current slice before the learner is asked to implement it."
  },
  {
    id: "validate-project",
    label: "Validate project",
    description: "Check the generated course for runnable files, coherent step budgets, and hidden tests."
  },
  {
    id: "materialize-workspace",
    label: "Materialize workspace",
    description: "Write the final blueprint, canonical project, learner workspace, and activation state."
  }
];

const CREATION_AGENT_TOOL_BY_ID = new Map(
  CREATION_AGENT_TOOL_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor])
);

const TOOL_INPUT_SCHEMA = z.object({
  jobId: z.string().optional(),
  stage: z.string().optional(),
  goal: z.string().optional(),
  summary: z.string().optional(),
  payload: z.record(z.unknown()).optional()
});

const TOOL_OUTPUT_SCHEMA = z.object({
  ok: z.boolean(),
  tool: z.string(),
  summary: z.string()
}).passthrough();

export type CreationAgentToolInput = z.infer<typeof TOOL_INPUT_SCHEMA>;
export type CreationAgentToolOutput = z.infer<typeof TOOL_OUTPUT_SCHEMA>;
export type CreationAgentToolHandler = (
  input: CreationAgentToolInput
) => Promise<CreationAgentToolOutput> | CreationAgentToolOutput;

export type CreationAgentToolHandlers = Partial<
  Record<CreationAgentToolId, CreationAgentToolHandler>
>;

export function buildCreationAgentInstructions(
  policy: CourseCreatorPolicy = buildDefaultCourseCreatorPolicy()
): string {
  return [
    "You are the single Construct creation agent.",
    "You own the full course-creation run: artifact lock, scope, research, course plan, solved project, learner files, lessons, validation, and materialization.",
    "Use tools as your visible work units. The UI renders these tool calls as the learner-facing creation trace.",
    "Keep deterministic host code for storage, validation, and file writes, but make all course-shape decisions from this agent policy.",
    "Do not scatter pedagogy across validators, repair prompts, or domain-specific exceptions.",
    "Changing this system prompt must be enough to change the course style across every stage.",
    "Default reliability behavior:",
    "- Keep one locked artifact identity from start to finish.",
    "- Prefer the smallest honest first behavior, then introduce the next concept only after an example/test exposes the shortcoming.",
    "- Explain why each visible class, field, helper, abstraction, or dependency exists at the exact step it appears.",
    "- Emit structured outputs that downstream validators can check instead of relying on prose.",
    "- Treat validation failures as course-shape signals, not as reasons to stuff more TODOs into one learner file.",
    "",
    "Course creator policy:",
    `id: ${policy.id}`,
    `role: ${policy.role}`,
    "system prompt:",
    policy.systemPrompt,
    "",
    "abilities:",
    ...policy.abilities.map((ability) => `- ${ability}`),
    "",
    "global directives:",
    ...policy.globalDirectives.map((directive) => `- ${directive}`),
    "",
    "stage directives:",
    ...Object.entries(policy.stageDirectives).flatMap(([stage, directives]) => [
      `- ${stage}:`,
      ...directives.map((directive) => `  - ${directive}`)
    ])
  ].join("\n");
}

export function createCreationAgentTools(
  handlers: CreationAgentToolHandlers = {}
): Record<CreationAgentToolId, ReturnType<typeof createTool>> {
  return Object.fromEntries(
    CREATION_AGENT_TOOL_DESCRIPTORS.map((descriptor) => {
      const tool = createTool({
        id: descriptor.id,
        description: descriptor.description,
        inputSchema: TOOL_INPUT_SCHEMA,
        outputSchema: TOOL_OUTPUT_SCHEMA,
        execute: async (input) => {
          const handler = handlers[descriptor.id];

          if (handler) {
            return handler(input);
          }

          return {
            ok: true,
            tool: descriptor.id,
            summary: `${descriptor.label} is handled by Construct's deterministic host pipeline.`
          };
        }
      });

      return [descriptor.id, tool];
    })
  ) as Record<CreationAgentToolId, ReturnType<typeof createTool>>;
}

export function createConstructCreationAgent(input: {
  model: string;
  policy?: CourseCreatorPolicy;
  tools?: Record<string, ReturnType<typeof createTool>>;
}) {
  return new Agent({
    id: CREATION_AGENT_ID,
    name: CREATION_AGENT_NAME,
    instructions: buildCreationAgentInstructions(input.policy),
    model: input.model,
    tools: input.tools ?? createCreationAgentTools(),
    maxRetries: 2
  });
}

export function createConstructCreationMastra(input: {
  model: string;
  policy?: CourseCreatorPolicy;
  tools?: Record<string, ReturnType<typeof createTool>>;
}) {
  const creationAgent = createConstructCreationAgent(input);

  return {
    creationAgent,
    mastra: new Mastra({
      agents: {
        [CREATION_AGENT_ID]: creationAgent
      }
    })
  };
}

export function getCreationAgentToolForStage(stage: string): CreationAgentToolId {
  const normalizedStage = stage.replace(/-stream$/, "");

  if (normalizedStage.includes("artifact-lock")) {
    return "lock-artifact";
  }

  if (
    normalizedStage.includes("scope") ||
    normalizedStage.includes("goal-self-report") ||
    normalizedStage.includes("creation-intake") ||
    normalizedStage.includes("knowledge-base")
  ) {
    return "scope-course";
  }

  if (normalizedStage.startsWith("research")) {
    return "research-course";
  }

  if (
    normalizedStage.includes("plan") ||
    normalizedStage.includes("roadmap") ||
    normalizedStage.includes("project-spec")
  ) {
    return "plan-course";
  }

  if (
    normalizedStage.includes("blueprint") ||
    normalizedStage.includes("compiler") ||
    normalizedStage.includes("solved-project") ||
    normalizedStage.includes("learner-diff")
  ) {
    return "generate-project";
  }

  if (
    normalizedStage.includes("lesson") ||
    normalizedStage.includes("deep-dive")
  ) {
    return "author-lessons";
  }

  if (
    normalizedStage.includes("validation") ||
    normalizedStage.includes("hidden-tests") ||
    normalizedStage.includes("repair")
  ) {
    return "validate-project";
  }

  if (
    normalizedStage.includes("materialization") ||
    normalizedStage.includes("support-files") ||
    normalizedStage.includes("canonical-files") ||
    normalizedStage.includes("learner-mask") ||
    normalizedStage.includes("dependency-install") ||
    normalizedStage.includes("workspace-bootstrap") ||
    normalizedStage.includes("activation") ||
    normalizedStage.includes("layout")
  ) {
    return "materialize-workspace";
  }

  return "plan-course";
}

export function buildCreationAgentEventPayload(input: {
  stage: string;
  level: "info" | "success" | "warning" | "error";
}): CreationAgentEventPayload {
  const tool = getCreationAgentToolForStage(input.stage);
  const descriptor = CREATION_AGENT_TOOL_BY_ID.get(tool);

  return {
    agentId: CREATION_AGENT_ID,
    agentName: CREATION_AGENT_NAME,
    mastra: true,
    tool,
    toolLabel: descriptor?.label ?? tool,
    thinking: input.level === "info",
    traceKind: "creation-agent-tool"
  };
}
