import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct Interact agent boundary", () => {
  it("uses the generic Construct agent runtime instead of importing Mastra directly", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /createConstructAgentRuntime/);
    assert.doesNotMatch(source, /@mastra\/core/);
  });

  it("declares structured actions, generated live steps, and scoped tool guidance", () => {
    const source = readFileSync(fileURLToPath(new URL("./constructInteractAgent.ts", import.meta.url)), "utf8");
    assert.match(source, /ConstructInteractActionSchema/);
    assert.match(source, /GeneratedLiveStepDraftSchema/);
    assert.match(source, /supportsGeneratedLiveSteps/);
    assert.match(source, /go-to-step/);
    assert.match(source, /open-concept/);
    assert.match(source, /generatedLiveSteps/);
    assert.match(source, /Use the smallest relevant set/);
    assert.match(source, /Never generate more than three/);
  });
});
