import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getActiveBlueprintPath,
  getDefaultBlueprintPath,
  setActiveBlueprintPath
} from "./activeBlueprint";

test("getActiveBlueprintPath returns null when no generated blueprint has been activated", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-active-blueprint-"));

  try {
    const activeBlueprintPath = await getActiveBlueprintPath(root);
    assert.equal(activeBlueprintPath, null);
    assert.match(
      getDefaultBlueprintPath(root),
      /blueprints[\/\\]workflow-runtime[\/\\]project-blueprint\.json$/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getActiveBlueprintPath resolves the stored generated blueprint path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "construct-active-blueprint-"));
  const blueprintPath = path.join(root, ".construct", "generated-blueprints", "sample", "project-blueprint.json");

  try {
    await mkdir(path.dirname(blueprintPath), { recursive: true });
    await writeFile(blueprintPath, "{}\n", "utf8");

    await setActiveBlueprintPath({
      rootDirectory: root,
      blueprintPath,
      now: () => new Date("2026-03-15T00:00:00.000Z")
    });

    const activeBlueprintPath = await getActiveBlueprintPath(root);
    assert.equal(activeBlueprintPath, blueprintPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
