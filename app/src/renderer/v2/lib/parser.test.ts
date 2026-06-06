import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseConstructSource } from "./parser";
import { currentBlock, nextPosition, totalBlocks } from "./runtime";
import type { ProjectRecord } from "../types";

const traceFailureProjectSource = readFileSync(
  fileURLToPath(new URL("../samples/trace-failure-learning-project.construct", import.meta.url)),
  "utf8"
);

describe(".construct parser", () => {
  it("parses the sample project into files and a linear tape", () => {
    const program = parseConstructSource(traceFailureProjectSource);

    assert.equal(program.id, "trace-failure-learning-project");
    assert.equal(program.files.length, 3);
    assert.equal(program.steps.length, 4);
    assert.equal(totalBlocks(program), 13);
    assert.equal(program.files[0]?.path, "package.json");
  });

  it("keeps guided edit blocks tied to target files", () => {
    const program = parseConstructSource(traceFailureProjectSource);
    const edits = program.steps.flatMap((step) =>
      step.blocks.filter((block) => block.kind === "edit")
    );

    assert.equal(edits.length, 2);
    assert.equal(edits[0]?.path, "mastra/agents/failure-analyst-agent.ts");
    assert.equal(edits[0]?.mode, "create");
    assert.match(edits[0]?.content ?? "", /failureAnalystAgent/);
  });

  it("advances through blocks without branching", () => {
    const program = parseConstructSource(traceFailureProjectSource);
    const project: ProjectRecord = {
      id: program.id,
      title: program.title,
      description: program.description,
      progress: 0,
      lastOpenedAt: null,
      workspacePath: "/tmp/construct-test",
      source: traceFailureProjectSource,
      program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      completedBlocks: {},
      completedAt: null
    };

    assert.equal(currentBlock(project)?.kind, "explain");
    assert.deepEqual(nextPosition(project), {
      currentStepIndex: 0,
      currentBlockIndex: 1,
      completedAt: null
    });
  });
});
