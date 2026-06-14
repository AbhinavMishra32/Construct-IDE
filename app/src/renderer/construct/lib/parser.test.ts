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
const tensorNumelProjectSource = readFileSync(
  fileURLToPath(new URL("../samples/tensor-numel-learning-project.construct", import.meta.url)),
  "utf8"
);
const agentRuntimeZodProjectSource = readFileSync(
  fileURLToPath(new URL("../samples/agent-runtime-zod-tape03.construct", import.meta.url)),
  "utf8"
);

describe(".construct parser", () => {
  it("parses the sample project into files and a linear tape", () => {
    const program = parseConstructSource(traceFailureProjectSource);

    assert.equal(program.id, "trace-failure-learning-project");
    assert.equal(program.spec, "tape-0.1");
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
      sourcePath: null,
      workspacePath: "/tmp/construct-test",
      source: traceFailureProjectSource,
      program,
      currentStepIndex: 0,
      currentBlockIndex: 0,
      activeFilePath: null,
      fileTreeExpanded: [],
      typingProgress: {},
      editAnchors: {},
      assistance: {},
      verificationResults: {},
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

  it("parses tape-0.2 learning blocks with references, focus anchors, recall, and agent verification", () => {
    const program = parseConstructSource(tensorNumelProjectSource);

    assert.equal(program.spec, "tape-0.2");
    assert.deepEqual(program.requires, [
      "ghost-edit",
      "recall-check",
      "focus-ranges",
      "reference-cards",
      "mastra-verify",
      "real-terminal"
    ]);
    assert.equal(program.references.length, 1);
    assert.equal(program.references[0]?.id, "tensor-numel-card");
    assert.equal(program.references[0]?.links[0]?.anchor, "tensor.numel");
    assert.equal(program.targets[0]?.id, "main.numel-smoke");

    const edit = program.steps[0]?.blocks.find((block) => block.kind === "edit");
    assert.equal(edit?.kind, "edit");
    assert.equal(edit?.anchor, "tensor.numel");
    assert.equal(edit?.notes.length, 2);

    const focusedExplain = program.steps[0]?.blocks.find(
      (block) => block.kind === "explain" && block.focus === "tensor.numel"
    );
    assert.equal(focusedExplain?.kind, "explain");

    const recall = program.steps[1]?.blocks.find((block) => block.kind === "recall");
    assert.equal(recall?.kind, "recall");
    assert.deepEqual(recall?.references, ["tensor-numel-card"]);
    assert.equal(recall?.verify?.kind, "agent");
    assert.equal(recall?.verify?.evidence.files.length, 3);
    assert.match(recall?.verify?.rubric ?? "", /Do not pass if the learner only hardcodes/);
  });

  it("parses tape-0.3 concept cards, rich support, and git milestones", () => {
    const program = parseConstructSource(agentRuntimeZodProjectSource);

    assert.equal(program.spec, "tape-0.3");
    assert.equal(program.concepts.length, 3);
    assert.equal(program.concepts[0]?.id, "zod.object-schema");
    assert.equal(program.concepts[0]?.docs[0]?.url, "https://zod.dev/");
    assert.equal(program.gitMilestones[0]?.after, "verify-add-tool");
    assert.equal(program.warnings.length, 0);

    const explain = program.steps[0]?.blocks.find((block) => block.kind === "explain");
    assert.equal(explain?.kind, "explain");
    assert.deepEqual(explain?.concepts, [
      "zod.object-schema",
      "agent.tool-contract",
      "runtime.validation"
    ]);

    const recall = program.steps[1]?.blocks.find((block) => block.kind === "recall");
    assert.equal(recall?.kind, "recall");
    assert.deepEqual(recall?.concepts, [
      "zod.object-schema",
      "agent.tool-contract",
      "runtime.validation"
    ]);
    assert.equal(recall?.supportSections.length, 5);
    assert.equal(recall?.supportSections[0]?.kind, "intent");
    assert.equal(recall?.verify?.id, "verify-add-tool");
  });

  it("parses namespaced guide blocks, teaching metadata, and step ordering", () => {
    const source = `@construct spec="tape-0.3"
@id "guide-fixture"
@title "Guide fixture"
@description "Exercises the guide layer."
@root "."
@audience "zero-prerequisite"
@teaching "mental-model-first vertical-slice-first"

::files
::file path="src/a.ts"
\`\`\`ts
export const value = 1;
\`\`\`
::end
::end

::concept id="system.value" title="System value" kind="core-concept"
::summary
The value used by this fixture.
::end
::guide.misconception
The value is not generated remotely.
::end
::end

::guide.orientation id="system-picture" title="System picture"
::guide.problem
Understand where [[file:src/a.ts|the value]] lives.
::end
::guide.flow
source -> runtime
::end
::end

::step id="change-value" title="Change the runtime value" kind="concept-to-code" teaches="system.value"
::guide.why-now
The source exists, so the next edit changes real behavior.
::end
::edit id="write-value" path="src/a.ts" mode="replace" typing="ghost" anchor="system.value"
::guide.why-now
This is the smallest useful boundary.
::end
\`\`\`ts
export const value = 2;
\`\`\`
::end
::end`;

    const program = parseConstructSource(source);

    assert.equal(program.audience, "zero-prerequisite");
    assert.deepEqual(program.teaching, ["mental-model-first", "vertical-slice-first"]);
    assert.equal(program.guides[0]?.guideKind, "guide.orientation");
    assert.equal(program.steps[0]?.kind, "orientation");
    assert.equal(program.steps[0]?.blocks[0]?.kind, "guide");
    assert.equal(program.steps[1]?.kind, "concept-to-code");
    assert.deepEqual(program.steps[1]?.teaches, ["system.value"]);
    const edit = program.steps[1]?.blocks.find((block) => block.kind === "edit");
    assert.equal(edit?.kind, "edit");
    assert.equal(edit?.guides[0]?.guideKind, "guide.why-now");
    assert.equal(program.concepts[0]?.guides[0]?.guideKind, "guide.misconception");
    assert.equal(program.warnings.filter((warning) => warning.id.startsWith("deprecated-guide:")).length, 2);
  });

  it("parses tape-0.3.1 and legacy tape-0.3 guide names", () => {
    const modern = parseConstructSource(`@construct spec="tape-0.3.1"
@id "guide-modern"
@title "Guide modern"
@description "Modern guide namespace"
::step id="s" title="S"
::guide.why-now
The namespaced guide block belongs to tape 0.3.1.
::end
::explain
Done.
::end
::end`);
    assert.equal(modern.spec, "tape-0.3.1");
    assert.equal(modern.steps[0]?.blocks[0]?.kind, "guide");

    const legacy = parseConstructSource(`@construct spec="tape-0.3"
@id "guide-legacy"
@title "Guide legacy"
@description "Legacy guide namespace"
::step id="s" title="S"
::mental-model
Older tapes can keep their pre-namespace guide block.
::end
::explain
Done.
::end
::end`);
    const firstBlock = legacy.steps[0]?.blocks[0];
    assert.equal(firstBlock?.kind, "guide");
    assert.equal(firstBlock?.kind === "guide" ? firstBlock.guideKind : "", "guide.mental-model");
  });

  it("parses tape-0.4 Construct Interact and reply recall", () => {
    const source = `@construct spec="tape-0.4"
@id "interact-fixture"
@title "Interact fixture"
@description "Exercises Construct Interact."
@root "."

::concept id="sandbox.runtime" title="Sandbox runtime" kind="concept"
::summary
A resumable execution workspace.
::end
::why
It keeps runtime design honest.
::end
::end

::step id="model" title="Model the sandbox"
::interact id="sandbox-model-check" uses="sandbox.runtime" kind="guided-contribution"
::prompt
What does a sandbox need to remember?
::end
::basis
The learner has seen local and cloud workspaces.
::end
::understanding
Identity, lifecycle, provider, and workspace state.
::end
::assessment
Pass if the answer can support the next edit.
::end
::resources
concepts="sandbox.runtime"
files="src/sandbox/types.ts"
::end
::end

::recall id="explain-boundary" mode="reply" uses="sandbox.runtime"
::task
Explain the provider boundary.
::end
::verify id="verify-boundary" kind="agent"
::goal
Verify the learner can explain it.
::end
::evidence
answer="latest"
interaction="sandbox-model-check"
::end
::rubric
Pass for a clear boundary explanation.
::end
::end
::end
::end`;

    const program = parseConstructSource(source);
    assert.equal(program.spec, "tape-0.4");
    const interact = program.steps[0]?.blocks[0];
    assert.equal(interact?.kind, "interact");
    assert.equal(interact?.kind === "interact" ? interact.prompt.trim() : "", "What does a sandbox need to remember?");
    assert.deepEqual(interact?.kind === "interact" ? interact.resources.concepts : [], ["sandbox.runtime"]);
    assert.deepEqual(interact?.kind === "interact" ? interact.resources.files : [], ["src/sandbox/types.ts"]);

    const recall = program.steps[0]?.blocks[1];
    assert.equal(recall?.kind, "recall");
    assert.equal(recall?.kind === "recall" ? recall.mode : "", "reply");
    assert.equal(recall?.kind === "recall" ? recall.verify?.evidence.answer : "", "latest");
    assert.equal(recall?.kind === "recall" ? recall.verify?.evidence.interaction : "", "sandbox-model-check");
    assert.equal(recall?.kind === "recall" ? recall.verify?.messages : undefined, undefined);
  });

  it("parses tape-0.4.1 as the dynamic Construct Interact feature spec", () => {
    const program = parseConstructSource(`@construct spec="tape-0.4.1"
@id "interact-041-fixture"
@title "Interact 0.4.1 fixture"
@description "Exercises dynamic Construct Interact features."
@root "."

::step id="model" title="Model the runtime"
::interact id="runtime-check" uses="runtime.validation" kind="guided-contribution"
::prompt
Why does runtime validation matter?
::end
::basis
The learner has seen TypeScript types.
::end
::understanding
Runtime data is untrusted until checked.
::end
::assessment
Pass if the answer mentions runtime input.
::end
::resources
concepts="runtime.validation"
::end
::end
::end`);

    assert.equal(program.spec, "tape-0.4.1");
    assert.equal(program.steps[0]?.blocks[0]?.kind, "interact");
  });

  it("defaults recall mode to code and deprecates guide blocks in tape-0.4", () => {
    const program = parseConstructSource(`@construct spec="tape-0.4"
@id "compat-fixture"
@title "Compat fixture"
@description "Exercises compatibility."
@root "."

::step id="s" title="Step"
::guide.why-now
Legacy authoring note.
::end
::recall id="r"
::task
Edit the file.
::end
::end
::end`);

    const guide = program.steps[0]?.blocks[0];
    const recall = program.steps[0]?.blocks[1];
    assert.equal(guide?.kind, "guide");
    assert.equal(recall?.kind === "recall" ? recall.mode : "", "code");
    assert.ok(program.warnings.some((warning) => warning.id.startsWith("deprecated-guide:")));
  });

  it("warns about missing file refs and pedagogy-leaking step titles", () => {
    const source = `@construct spec="tape-0.3"
@id "lint-fixture"
@title "Lint fixture"
@description "Exercises authoring warnings."
@root "."

::step id="leaky" title="Reveal why this works" requires="missing.concept"
::explain
Open [[file:src/missing.ts|the implementation]].
::end
::end`;

    const program = parseConstructSource(source);
    const warningIds = program.warnings.map((warning) => warning.id);
    assert.ok(warningIds.some((id) => id.startsWith("file-ref-missing:")));
    assert.ok(warningIds.some((id) => id.startsWith("step-requires-missing:")));
    assert.ok(warningIds.some((id) => id.startsWith("title-pedagogy-leak:")));
  });
});
