import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("Construct project advanced settings", () => {
  it("edits and validates the real project tape through a dedicated API", () => {
    const source = readFileSync(fileURLToPath(new URL("./ConstructSettingsSurface.tsx", import.meta.url)), "utf8");
    const preload = readFileSync(fileURLToPath(new URL("../../preload/index.ts", import.meta.url)), "utf8");
    const controller = readFileSync(fileURLToPath(new URL("../../main/ipc/ConstructProjectIpcController.ts", import.meta.url)), "utf8");

    assert.match(source, /id: "project-advanced"/);
    assert.match(source, /Edit project tape/);
    assert.match(source, /validateConstructSource\(tapeSource\)/);
    assert.match(source, /updateProjectTape\(/);
    assert.match(source, /Save and reload tape/);
    assert.match(preload, /construct:project:read-tape/);
    assert.match(preload, /construct:project:update-tape/);
    assert.match(controller, /Tape project id must remain/);
    assert.match(controller, /await writeFile\(project\.sourcePath, project\.source/);
    assert.match(controller, /materializeInitialFiles\(project\)/);
  });
});
