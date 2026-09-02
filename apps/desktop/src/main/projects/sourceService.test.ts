import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SourceService } from "./sourceService.js";

/* The point of this service is that it reads outside any project, so the
   fixture is a directory Construct knows nothing about. */
let root: string;
const source = new SourceService();

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "construct-source-"));
  await mkdir(path.join(root, "lib"));
  await writeFile(path.join(root, "lib", "console.d.ts"), "declare const console: Console;\n", "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reading a definition's file", () => {
  it("reads a file by absolute path", async () => {
    await expect(source.read(path.join(root, "lib", "console.d.ts"))).resolves.toBe("declare const console: Console;\n");
  });

  it("describes a file and a directory differently", async () => {
    const file = await source.stat(path.join(root, "lib", "console.d.ts"));
    const directory = await source.stat(path.join(root, "lib"));
    expect(file.type).toBe("file");
    expect(file.size).toBeGreaterThan(0);
    expect(directory.type).toBe("directory");
    expect(directory.size).toBe(0);
  });

  it("lists a directory with absolute paths, so the caller joins nothing", async () => {
    const entries = await source.list(path.join(root, "lib"));
    expect(entries).toEqual([{ path: path.join(root, "lib", "console.d.ts"), name: "console.d.ts", type: "file" }]);
  });

  it("refuses to read a directory as text", async () => {
    await expect(source.read(path.join(root, "lib"))).rejects.toThrow(/folder/);
  });

  it("reports a path that is not there rather than returning nothing", async () => {
    await expect(source.read(path.join(root, "lib", "missing.ts"))).rejects.toThrow();
  });
});
