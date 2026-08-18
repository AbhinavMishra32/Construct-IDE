import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceService } from "./workspaceService.js";

let root: string;
let outside: string;
let workspace: WorkspaceService;

beforeEach(() => {
  const base = mkdtempSync(path.join(tmpdir(), "construct-workspace-"));
  root = path.join(base, "project");
  outside = path.join(base, "secrets");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keys.txt"), "do not read me");
  workspace = new WorkspaceService();
});

afterEach(() => {
  rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("staying inside the project", () => {
  it.each(["../secrets/keys.txt", "..", "../../etc/passwd", "nested/../../secrets/keys.txt"])(
    "refuses %s",
    (candidate) => {
      expect(() => workspace.resolveInside(root, candidate)).toThrow(/Invalid project file path|escaped its folder/);
    },
  );

  it("refuses an absolute path even when it points inside", () => {
    expect(() => workspace.resolveInside(root, path.join(root, "main.py"))).toThrow(/Invalid project file path/);
  });

  it("allows an ordinary nested path", () => {
    expect(workspace.resolveInside(root, "src/main.py")).toBe(path.join(root, "src", "main.py"));
  });

  it("allows a path that walks up and back within the project", () => {
    expect(workspace.resolveInside(root, "src/../main.py")).toBe(path.join(root, "main.py"));
  });

  it("refuses to read through a symlink pointing out of the project", async () => {
    symlinkSync(path.join(outside, "keys.txt"), path.join(root, "link.txt"));
    /* resolveInside accepts the name — the escape is in what it points at — so
       this asserts on the read, which is where it would actually leak. */
    await expect(workspace.read(root, "link.txt")).rejects.toThrow();
  });
});

describe("listing a directory", () => {
  beforeEach(() => {
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, ".git"));
    writeFileSync(path.join(root, "main.py"), "");
    writeFileSync(path.join(root, "README.md"), "");
    writeFileSync(path.join(root, "src", "util.py"), "");
  });

  it("puts directories first, then sorts by name", async () => {
    /* localeCompare, not ASCII: README.md sorts after main.py because case is
       a weaker signal than letter. That is the ordering a person expects. */
    expect((await workspace.list(root)).map((entry) => entry.name)).toEqual(["src", "main.py", "README.md"]);
  });

  it("hides the directories nobody wants to walk", async () => {
    const names = (await workspace.list(root)).map((entry) => entry.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
  });

  it("lists one level only, so a large repository costs the same as a small one", async () => {
    const entries = await workspace.list(root);
    expect(entries.every((entry) => !("children" in entry))).toBe(true);
  });

  it("addresses nested entries with POSIX separators on every host", async () => {
    expect((await workspace.list(root, "src")).map((entry) => entry.path)).toEqual(["src/util.py"]);
  });

  it("answers with nothing rather than throwing for a directory that has gone", async () => {
    expect(await workspace.list(root, "missing")).toEqual([]);
  });
});

describe("reading and writing", () => {
  it("round-trips a file", async () => {
    await workspace.write(root, "src/main.py", "print('hi')");
    expect(await workspace.read(root, "src/main.py")).toBe("print('hi')");
  });

  it("creates missing parent directories on write", async () => {
    await workspace.write(root, "a/b/c/deep.py", "x");
    expect(await workspace.read(root, "a/b/c/deep.py")).toBe("x");
  });

  it("refuses to open a file too large for the editor, by size not by content", async () => {
    writeFileSync(path.join(root, "huge.bin"), Buffer.alloc(2_000_001));
    await expect(workspace.read(root, "huge.bin")).rejects.toThrow(/too large to open/);
  });

  it("says a folder is a folder rather than failing obscurely", async () => {
    mkdirSync(path.join(root, "src"));
    await expect(workspace.read(root, "src")).rejects.toThrow(/is a folder/);
  });
});

describe("changing the tree", () => {
  it("never truncates an existing file when creating one", async () => {
    await workspace.write(root, "main.py", "important");
    await expect(workspace.createFile(root, "main.py")).rejects.toThrow(/already exists/);
    expect(await workspace.read(root, "main.py")).toBe("important");
  });

  it("refuses a rename that would overwrite something", async () => {
    await workspace.write(root, "a.py", "a");
    await workspace.write(root, "b.py", "b");
    await expect(workspace.rename(root, "a.py", "b.py")).rejects.toThrow(/already exists/);
    expect(await workspace.read(root, "b.py")).toBe("b");
  });

  it("renames a file", async () => {
    await workspace.write(root, "a.py", "a");
    await workspace.rename(root, "a.py", "src/b.py".replace("src/", ""));
    expect(await workspace.read(root, "b.py")).toBe("a");
  });

  it("removes a directory and everything under it", async () => {
    await workspace.write(root, "tmp/one.py", "1");
    await workspace.remove(root, "tmp");
    expect((await workspace.list(root)).map((entry) => entry.name)).not.toContain("tmp");
  });

  it("refuses to remove anything outside the project", async () => {
    await expect(workspace.remove(root, "../secrets")).rejects.toThrow();
  });
});
