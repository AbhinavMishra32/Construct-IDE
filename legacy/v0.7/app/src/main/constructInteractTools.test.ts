import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultLearningState } from "../shared/constructLearning";
import {
  buildAuthoredResourceContext,
  buildConstructInteractHistorySummary,
  buildLearnerStateSummary,
  buildProjectLearnerStateSummary
} from "./constructInteractTools";

describe("Construct Interact authored resource provenance", () => {
  it("keeps ABI wording attributed to its concept card instead of the lesson step", () => {
    const learningState = createDefaultLearningState("test-device");
    learningState.projects["mbr-from-scratch"] = {
      projectId: "mbr-from-scratch",
      conceptUnderstanding: {},
      constructInteractSessions: [],
      recallAttempts: [],
      assistanceEvents: [],
      conceptEngagement: {},
      plannedOverlays: [],
      generatedLiveSteps: [],
      generatedLiveStepRuns: []
    };

    const context = buildAuthoredResourceContext({
      project: {
        id: "mbr-from-scratch",
        title: "MBR from scratch",
        workspacePath: "/tmp/mbr-from-scratch",
        currentStepIndex: 0,
        currentBlockIndex: 1,
        program: {
          steps: [
            {
              id: "understand-sector-zero",
              title: "Understand what sector 0 is allowed to mean",
              blocks: [
                {
                  id: "explain-sector-zero",
                  kind: "explain",
                  content: "The disk wants bytes at fixed offsets. Other tools know the same ancient contract.",
                  concepts: ["disk.sector", "mbr.layout"]
                },
                {
                  id: "sector-zero-model",
                  kind: "interact",
                  prompt: "Why is an MBR implementation more like writing an ABI?",
                  resources: {
                    concepts: ["disk.sector"],
                    references: ["mbr-byte-map"],
                    steps: ["understand-sector-zero"],
                    files: []
                  }
                }
              ]
            }
          ],
          concepts: [
            {
              id: "disk.sector",
              title: "Sector 0 is a byte-level contract",
              commonMistake: "It is closer to a hardware-era ABI. Offsets, widths, and endianness matter."
            }
          ],
          references: [
            {
              id: "mbr-byte-map",
              title: "Classic MBR byte map"
            }
          ]
        }
      },
      request: {
        projectId: "mbr-from-scratch",
        blockId: "sector-zero-model",
        tapeSpec: "tape-0.4.2",
        prompt: "Why is an MBR implementation more like writing an ABI?",
        answer: "The lesson never said ABI.",
        basis: "The learner saw fixed offsets.",
        understanding: "Byte position is the external contract.",
        assessment: "Use exact authored evidence.",
        resources: {
          concepts: ["disk.sector"],
          references: ["mbr-byte-map"],
          steps: ["understand-sector-zero"],
          files: []
        }
      },
      learningState
    });

    assert.equal(context.sourceType, "authored-resource-map");
    assert.equal(context.steps[0]?.sourceType, "authored-step");
    assert.equal(JSON.stringify(context.steps).includes("hardware-era ABI"), false);
    assert.equal(context.concepts[0]?.sourceType, "authored-concept-card");
    assert.equal(JSON.stringify(context.concepts).includes("hardware-era ABI"), true);
    assert.deepEqual(context.concepts[0]?.engagement, {
      opened: false,
      openCount: 0,
      firstOpenedAt: undefined,
      lastOpenedAt: undefined,
      saved: false,
      savedAt: undefined
    });
    assert.equal(context.references[0]?.sourceType, "authored-reference-card");
  });
});

describe("Construct Interact compact learner context", () => {
  it("does not return prior traces and tool payloads to the model", () => {
    const state = createDefaultLearningState("test-device");
    state.projects.project = {
      projectId: "project",
      conceptUnderstanding: {},
      constructInteractSessions: [{
        id: "session-1",
        projectId: "project",
        blockId: "general:project",
        prompt: "Ask",
        answer: "Help me",
        status: "continue",
        confidence: "low",
        reply: "Here is focused help.",
        coveredConceptIds: [],
        missingConceptIds: [],
        assistanceLevel: "hint",
        createdAt: new Date().toISOString(),
        toolCalls: [{ id: "tool-1", name: "largeTool", reason: "test", outputPreview: "large payload", createdAt: new Date().toISOString() }],
        agentEvents: [{ id: "event-1", type: "reasoning", status: "completed", title: "Analysis", text: "private", createdAt: new Date().toISOString() }]
      }],
      recallAttempts: [],
      assistanceEvents: [],
      conceptEngagement: {},
      plannedOverlays: [],
      generatedLiveSteps: [],
      generatedLiveStepRuns: []
    };

    const globalSummary = buildLearnerStateSummary(state, []);
    const projectSummary = buildProjectLearnerStateSummary(state, "project");
    const history = buildConstructInteractHistorySummary(state, "project", 8);

    assert.equal(globalSummary.projectCount, 1);
    assert.equal(projectSummary?.interactAttemptCount, 1);
    assert.equal("agentEvents" in history[0], false);
    assert.equal("toolCalls" in history[0], false);
    assert.equal(JSON.stringify(history).includes("large payload"), false);
    assert.equal(JSON.stringify(history).includes("private"), false);
  });
});
