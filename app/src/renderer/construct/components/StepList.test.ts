import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("StepList generated live step UI", () => {
  it("merges static and generated live steps with an amber generated treatment", () => {
    const source = readFileSync(fileURLToPath(new URL("./StepList.tsx", import.meta.url)), "utf8");
    const css = readFileSync(fileURLToPath(new URL("../styles/construct.css", import.meta.url)), "utf8");

    assert.match(source, /mergeStaticAndLiveSteps/);
    assert.match(source, /insertAfterStepId/);
    assert.match(source, /insertBeforeStepId/);
    assert.match(source, /Generated Live/);
    assert.match(source, /step-timeline__step--live/);
    assert.match(css, /\.step-timeline__step--live/);
    assert.match(css, /#f59e0b/);
  });

  it("keeps the right-panel Steps tab full-height with an internal scroller", () => {
    const css = readFileSync(fileURLToPath(new URL("../styles/construct.css", import.meta.url)), "utf8");

    assert.match(css, /\.workspace-right-panel-steps\s*\{[\s\S]*height: 100%/);
    assert.match(css, /\.workspace-right-panel-steps\s*\{[\s\S]*max-height: none/);
    assert.match(css, /\.workspace-right-panel-steps \.step-timeline\s*\{[\s\S]*overflow-y: auto/);
  });
});
