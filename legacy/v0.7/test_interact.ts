import { configureConstructDataPaths, createConstructDataPaths } from "../app/src/main/config/constructConfig";
import { runConstructInteract } from "../app/src/main/constructInteractAgent";
import { createConstructInteractTools } from "../app/src/main/constructInteractTools";
import { createDefaultLearningState } from "../app/src/shared/constructLearning";
import assert from "node:assert/strict";
import path from "path";

async function main() {
  // Set up data paths to read config
  const userDataRoot = path.join(process.env.HOME || "", "Library/Application Support/Construct");
  configureConstructDataPaths(createConstructDataPaths(userDataRoot));

  const mockProject = {
    id: "mbr-from-scratch",
    title: "MBR from scratch",
    workspacePath: "/tmp",
    program: {
      steps: [
        {
          id: "understand-sector-zero",
          title: "Understand what sector 0 is allowed to mean",
          teaches: ["disk.sector", "mbr.layout"],
          blocks: [
            {
              id: "sector-zero-explain",
              kind: "explain",
              content: "The classic MBR does not have field names. It has positions. Your program wants a friendly model, while the disk wants bytes at fixed offsets."
            },
            {
              id: "sector-zero-model",
              kind: "interact",
              prompt: "Why is an MBR implementation more like writing an ABI than writing a normal file format?",
              basis: "The learner has seen that the MBR is a fixed 512-byte sector and that other tools interpret it by offset.",
              understanding: "A strong answer should mention fixed byte offsets, external tools or firmware, and the difference between C++ structures and raw sector bytes.",
              assessment: "If the learner asks whether ABI was explained, distinguish the authored step from attached concept-card wording."
            }
          ]
        }
      ],
      concepts: [
        {
          id: "disk.sector",
          title: "Sector 0 is a byte-level contract",
          summary: "Other tools interpret the sector by byte position.",
          commonMistake: "It is closer to a hardware-era ABI. Offsets matter. Widths matter. Endianness matters."
        },
        {
          id: "mbr.layout",
          title: "The classic MBR layout",
          summary: "The partition table and signature occupy fixed ranges."
        }
      ],
      references: [],
      files: []
    },
    currentStepIndex: 0,
    currentBlockIndex: 1
  };

  const learningState = createDefaultLearningState("test-device");

  const input = {
    projectId: "mbr-from-scratch",
    blockId: "sector-zero-model",
    tapeSpec: "tape-0.4.2",
    prompt: "Why is an MBR implementation more like writing an ABI than writing a normal file format?",
    answer: "Can you tell me the exact reference sentence? I reread step 1 and it does not talk about ABI.",
    basis: "The learner has seen that the MBR is a fixed 512-byte sector and that other tools interpret it by offset.",
    understanding: "A strong answer distinguishes authored step text from concept-card wording.",
    assessment: "State where the ABI wording actually appears and do not attribute it to the step.",
    resources: {
      concepts: ["disk.sector", "mbr.layout"],
      files: [],
      references: [],
      steps: ["understand-sector-zero"]
    },
    learningState
  };

  const { tools, toolCalls } = createConstructInteractTools({
    project: mockProject,
    request: input,
    learningState,
    latestTerminalOutput: "",
    onToolCall: (tc) => {
      console.log(`\n>>> TOOL CALL CALLED: ${tc.name}`);
      console.log(`Reason: ${tc.reason}`);
      console.log(`Input: ${JSON.stringify(tc.input)}`);
      console.log(`Output preview: ${tc.outputPreview}`);
    }
  });

  const traceTitles: string[] = [];
  console.log("Starting real tape-0.4.2 Construct Interact run...");
  const result = await runConstructInteract(
    input,
    (entry) => {
      traceTitles.push(entry.title);
      console.log(`[Trace] ${entry.title}: ${entry.detail}`);
    },
    tools
  );

  console.log("\n================ RESULT ================");
  console.log(JSON.stringify(result, null, 2));
  console.log("========================================\n");

  assert.ok(toolCalls.length > 0, "the agent should choose at least one grounding tool");
  assert.ok(traceTitles.includes("Agent iteration"), "Mastra iterations should be observable");
  assert.ok(traceTitles.includes("Agent run completed"), "the agent should complete the same run");
  assert.doesNotMatch(result.reply, /\b(?:let me|i(?:'|’)ll|i will)\s+(?:check|inspect|look|read|review|find|search)\b/i);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
