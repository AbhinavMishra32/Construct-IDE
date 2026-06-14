import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("StepList generated live step UI", () => {
  it("merges static and generated live steps with an amber generated treatment", () => {
    const source = readFileSync(fileURLToPath(new URL("./StepList.tsx", import.meta.url)), "utf8");
    assert.match(source, /mergeStaticAndLiveSteps/);
    assert.match(source, /insertAfterStepId/);
    assert.match(source, /insertBeforeStepId/);
    assert.match(source, /Generated Live/);
    assert.match(source, /<Timeline/);
    assert.match(source, /<Badge variant="secondary">Generated Live<\/Badge>/);
  });

  it("keeps the right-panel Steps tab full-height with an internal scroller", () => {
    const source = readFileSync(fileURLToPath(new URL("./StepList.tsx", import.meta.url)), "utf8");
    const workspace = readFileSync(fileURLToPath(new URL("./Workspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /className="h-full overflow-y-auto"/);
    assert.match(workspace, /className="flex h-full min-h-0 flex-col"/);
    assert.match(workspace, /"min-h-0 flex-1 overflow-hidden"/);
  });
});
