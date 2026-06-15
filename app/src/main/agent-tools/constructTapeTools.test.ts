import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileDynamicStepSource,
  parseDynamicStepSource,
  type ConstructTapeToolProject
} from "./constructTapeTools";

const source = `@construct spec="tape-0.4.2"
@id "dynamic-tool-test"
@title "Dynamic tool test"
@description "Tests production Dynamic Step compilation."
@root "."

::step id="intro" title="See the system"
::explain
Start with the authored system shape.
::end
::end`;

const project: ConstructTapeToolProject = {
  id: "dynamic-tool-test",
  title: "Dynamic tool test",
  workspacePath: "/tmp/dynamic-tool-test",
  source,
  currentStepIndex: 0,
  currentBlockIndex: 0,
  program: {
    spec: "tape-0.4.2",
    description: "Tests production Dynamic Step compilation.",
    files: [],
    steps: [{
      id: "intro",
      title: "See the system",
      teaches: [],
      requires: [],
      blocks: [{ id: "intro:explain:1", kind: "explain", content: "Start with the authored system shape." }]
    }]
  }
};

describe("reusable Construct tape agent tools", () => {
  it("parses and compiles one multi-block Dynamic Step with the production compiler", () => {
    const candidate = `::step id="dynamic-practice" title="Practice the system shape"
::explain
Trace one concrete input through the system before changing code.
::end

::run id="inspect-project" cwd="."
npm test
::end

::expect id="tests-pass" type="manual"
The focused test passes and names the expected boundary.
::end

::checkpoint id="shape-understood"
You can now explain the input, output, and boundary.
::end
::end`;

    const parsed = parseDynamicStepSource(project, candidate);
    assert.equal(parsed.proposedSteps[0]?.id, "dynamic-practice");
    assert.deepEqual(parsed.proposedSteps[0]?.blockKinds, ["explain", "run", "expect", "checkpoint"]);

    const compiled = compileDynamicStepSource(project, candidate);
    assert.equal(compiled.valid, true);
    assert.equal(compiled.step?.id, "dynamic-practice");
    assert.deepEqual(compiled.step?.blocks.map((block) => block.kind), ["explain", "run", "expect", "checkpoint"]);
  });

  it("rejects malformed or duplicate Dynamic Step source", () => {
    const malformed = compileDynamicStepSource(project, `::step id="intro" title="Duplicate"
::explain
This never closes.`);

    assert.equal(malformed.valid, false);
    assert.equal(malformed.diagnostics.some((diagnostic) => diagnostic.severity === "error"), true);
  });
});
