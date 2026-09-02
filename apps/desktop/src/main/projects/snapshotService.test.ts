import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SnapshotService } from "./snapshotService.js";

/**
 * Undo has to be exact, because the alternative is losing the learner's work.
 * Every case here is something a turn genuinely does to a project.
 */
let root: string;
let snapshots: SnapshotService;

const write = (relative: string, body: string) => {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, "utf8");
};
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const there = (relative: string) => existsSync(path.join(root, relative));

/** Capture, then restore from the captured blobs — the round trip the store
 *  performs, without the database in the way. */
const roundTrip = async () => {
  const captured = await snapshots.capture(root);
  if (!captured) throw new Error("nothing captured");
  return async () => {
    await snapshots.restore(root, captured.files, (hash) => captured.blobs.get(hash) ?? null);
  };
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "construct-snapshot-"));
  snapshots = new SnapshotService();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("capture", () => {
  it("records every file, nested ones included", async () => {
    write("main.py", "print(1)");
    write("src/lib/util.py", "x = 1");
    const captured = await snapshots.capture(root);
    expect(captured?.files.map((file) => file.path).sort()).toEqual(["main.py", "src/lib/util.py"]);
  });

  it("stores one copy of identical content", async () => {
    /* Content-addressed: twenty turns over one project should not be twenty
       copies of the same unchanged file. */
    write("a.py", "same");
    write("b.py", "same");
    const captured = await snapshots.capture(root);
    expect(captured?.files).toHaveLength(2);
    expect(captured?.blobs.size).toBe(1);
  });

  it("skips build output and dependency trees", async () => {
    write("main.py", "x");
    write("node_modules/dep/index.js", "junk");
    write(".git/HEAD", "ref");
    write("dist/out.js", "built");
    const captured = await snapshots.capture(root);
    expect(captured?.files.map((file) => file.path)).toEqual(["main.py"]);
  });

  it("keeps Flow Memory, which a turn writes", async () => {
    /* `.construct` is the agent's own memory. Undoing a turn has to undo what
       it remembered, so this one dotted directory is deliberately captured. */
    write(".construct/learner.md", "# Learner");
    const captured = await snapshots.capture(root);
    expect(captured?.files.map((file) => file.path)).toContain(".construct/learner.md");
  });
});

describe("restore", () => {
  it("puts an edited file back", async () => {
    write("main.py", "original");
    const undo = await roundTrip();
    write("main.py", "the agent rewrote this");
    await undo();
    expect(read("main.py")).toBe("original");
  });

  it("deletes a file the agent created", async () => {
    write("main.py", "x");
    const undo = await roundTrip();
    write("scratch.py", "created during the turn");
    await undo();
    expect(there("scratch.py")).toBe(false);
    expect(there("main.py")).toBe(true);
  });

  it("brings back a file the agent deleted", async () => {
    write("notes.md", "keep me");
    const undo = await roundTrip();
    rmSync(path.join(root, "notes.md"));
    await undo();
    expect(read("notes.md")).toBe("keep me");
  });

  it("restores a nested file into a directory that was removed", async () => {
    write("src/deep/x.py", "body");
    const undo = await roundTrip();
    rmSync(path.join(root, "src"), { recursive: true });
    await undo();
    expect(read("src/deep/x.py")).toBe("body");
  });

  it("leaves node_modules alone", async () => {
    /* Never captured, so never deleted — an undo that wiped an install would
       cost far more than the turn it undid. */
    write("main.py", "x");
    const undo = await roundTrip();
    write("node_modules/dep/index.js", "installed during the turn");
    await undo();
    expect(there("node_modules/dep/index.js")).toBe(true);
  });

  it("refuses rather than half-restoring when a blob is missing", async () => {
    /* Writing the rest would present a half-restored tree as a whole one, and
       then delete everything the manifest did not mention. */
    write("main.py", "x");
    const captured = (await snapshots.capture(root))!;
    await expect(snapshots.restore(root, captured.files, () => null)).rejects.toThrow(/missing part of the project/i);
  });

  it("is idempotent", async () => {
    write("main.py", "original");
    const undo = await roundTrip();
    write("main.py", "changed");
    await undo();
    await undo();
    expect(read("main.py")).toBe("original");
  });
});
