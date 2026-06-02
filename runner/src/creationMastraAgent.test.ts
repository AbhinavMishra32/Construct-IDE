import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATION_AGENT_ID,
  CREATION_AGENT_TOOL_DESCRIPTORS,
  buildCreationAgentEventPayload,
  buildCreationAgentInstructions,
  createConstructCreationAgent,
  createCreationAgentTools,
  getCreationAgentToolForStage
} from "./creationMastraAgent.js";

test("creation Mastra agent has one central tool vocabulary", () => {
  assert.equal(CREATION_AGENT_ID, "construct-creation-agent");
  assert.deepEqual(
    CREATION_AGENT_TOOL_DESCRIPTORS.map((descriptor) => descriptor.id),
    [
      "lock-artifact",
      "scope-course",
      "research-course",
      "plan-course",
      "generate-project",
      "author-lessons",
      "validate-project",
      "materialize-workspace"
    ]
  );
});

test("creation Mastra agent instructions are policy driven", () => {
  const instructions = buildCreationAgentInstructions({
    id: "test-policy",
    role: "test-course-creator",
    systemPrompt: "Start naive, explain the shortcoming, then add the next capability.",
    abilities: ["choose every course slice"],
    globalDirectives: ["no scattered domain exceptions"],
    stageDirectives: {
      plan: ["plan from policy"],
      blueprint: ["generate from policy"],
      frontier: ["repair from policy"],
      lesson: ["teach from policy"]
    }
  });

  assert.match(instructions, /single Construct creation agent/i);
  assert.match(instructions, /Start naive, explain the shortcoming/i);
  assert.match(instructions, /no scattered domain exceptions/i);
  assert.match(instructions, /Changing this system prompt must be enough/i);
});

test("creation Mastra tools can delegate to deterministic host handlers", async () => {
  const tools = createCreationAgentTools({
    "plan-course": async (input) => ({
      ok: true,
      tool: "plan-course",
      summary: `planned ${input.goal ?? "unknown"}`
    })
  });

  const toolContext = {} as Parameters<NonNullable<typeof tools["plan-course"]["execute"]>>[1];
  const result = await tools["plan-course"].execute?.({
    goal: "leaky bucket limiter"
  }, toolContext);

  assert.deepEqual(result, {
    ok: true,
    tool: "plan-course",
    summary: "planned leaky bucket limiter"
  });
});

test("creation Mastra agent can be constructed with the central policy and tools", () => {
  const agent = createConstructCreationAgent({
    model: "openai/gpt-5.4-nano"
  });

  assert.equal(agent.id, CREATION_AGENT_ID);
  assert.equal(agent.name, "Construct Creation Agent");
});

test("creation events map old stages into visible agent tools", () => {
  assert.equal(getCreationAgentToolForStage("artifact-lock"), "lock-artifact");
  assert.equal(getCreationAgentToolForStage("blueprint-generation"), "generate-project");
  assert.equal(getCreationAgentToolForStage("lesson-authoring-stream"), "author-lessons");
  assert.equal(getCreationAgentToolForStage("workspace-bootstrap"), "materialize-workspace");

  assert.deepEqual(buildCreationAgentEventPayload({
    stage: "blueprint-generation",
    level: "info"
  }), {
    agentId: CREATION_AGENT_ID,
    agentName: "Construct Creation Agent",
    mastra: true,
    tool: "generate-project",
    toolLabel: "Generate project",
    thinking: true,
    traceKind: "creation-agent-tool"
  });
});
