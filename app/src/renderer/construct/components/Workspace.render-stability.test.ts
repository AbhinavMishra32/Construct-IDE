import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const workspaceSource = readFileSync(fileURLToPath(new URL("./Workspace.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../ConstructApplication.tsx", import.meta.url)), "utf8");

describe("Workspace render stability", () => {
  it("uses stable empty arrays for optional project data read during render", () => {
    assert.match(workspaceSource, /const EMPTY_CONCEPTS: ConceptCard\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_GENERATED_LIVE_STEPS: GeneratedLiveStep\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_GIT_MILESTONES: GitMilestone\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_REFERENCE_CARDS: ReferenceCardData\[\] = \[\];/);
    assert.match(workspaceSource, /const EMPTY_TARGETS: ConstructTarget\[\] = \[\];/);

    assert.doesNotMatch(workspaceSource, /project\.program\.(?:concepts|gitMilestones|references|targets)\s*\?\?\s*\[\]/);
    assert.doesNotMatch(workspaceSource, /projectLearningState\?\.generatedLiveSteps\s*\?\?\s*\[\]/);
  });

  it("keeps parent callback effects from retriggering on every project render", () => {
    assert.match(appSource, /const handleWorkspaceTreeChange = useCallback/);
    assert.match(appSource, /onTreeChange=\{handleWorkspaceTreeChange\}/);
    assert.doesNotMatch(appSource, /onTreeChange=\{\(tree, activePath, relevantPath/);
    assert.match(workspaceSource, /\[tree, activeFilePath, relevantPath, onTreeChange\]/);

    const guideMemo = workspaceSource.match(/const guideTabContent = useMemo\([\s\S]*?\n  \), \[([^\]]*)\]\);/);
    assert.ok(guideMemo, "expected guide tab content memo dependency list");
    assert.doesNotMatch(guideMemo[1], /generatedLiveSteps/);
  });
});
