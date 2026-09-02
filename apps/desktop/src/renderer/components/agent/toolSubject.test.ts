import { describe, expect, it } from "vitest";

import { baseName, toolSubject } from "./toolSubject";

const json = (value: unknown) => JSON.stringify(value);

describe("toolSubject", () => {
  /* The whole point: a column of bare verbs says the agent did five things and
     nothing about which. */
  it("names the file a read or a write was about", () => {
    expect(toolSubject("read-file", json({ path: "src/main.py" }))).toEqual({
      verb: "Read",
      subject: "main.py",
      path: "src/main.py",
    });
    expect(toolSubject("write-file", json({ path: "main.py", content: "x" }))).toMatchObject({
      verb: "Wrote",
      subject: "main.py",
    });
  });

  it("says what is happening while it happens", () => {
    expect(toolSubject("read-file", json({ path: "main.py" }), true)?.verb).toBe("Reading");
    expect(toolSubject("run-terminal-command", json({ command: "ls" }), true)?.verb).toBe("Running");
  });

  it("shows the command itself", () => {
    expect(toolSubject("run-terminal-command", json({ command: "python main.py" }))).toEqual({
      verb: "Ran",
      subject: "python main.py",
    });
  });

  it("keeps a long command to one line", () => {
    const long = `pip install torch ${"x".repeat(120)}`;
    const subject = toolSubject("run-terminal-command", json({ command: long }))!.subject;
    expect(subject.length).toBeLessThanOrEqual(60);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("flattens a command written across lines", () => {
    expect(toolSubject("run-terminal-command", json({ command: "cd src &&\n  pytest" }))?.subject).toBe("cd src && pytest");
  });

  it("names the project root when a listing has no directory", () => {
    expect(toolSubject("list-files", json({}))).toEqual({ verb: "Listed", subject: "the project" });
    expect(toolSubject("list-files", json({ directory: "src/lib" }))).toMatchObject({ subject: "lib", path: "src/lib" });
  });

  it("reduces a fetched url to its host", () => {
    expect(toolSubject("web-fetch", json({ url: "https://www.pytorch.org/docs/x" }))?.subject).toBe("pytorch.org");
  });

  it("summarises a memory read rather than listing four files", () => {
    expect(toolSubject("flow-memory-fetch", json({ files: [] }))?.subject).toBe("what it knows");
    expect(toolSubject("flow-memory-fetch", json({ files: ["learner.md", "path.md"] }))?.subject).toBe("learner.md, path.md");
  });

  it("names the files a memory patch touched, once each", () => {
    const patches = [{ file: "learner.md" }, { file: "learner.md" }, { file: "path.md" }];
    expect(toolSubject("flow-memory-patch", json({ patches }))?.subject).toBe("learner.md, path.md");
  });

  it("gives up rather than guessing", () => {
    /* Turns written before tool arguments were stored have nothing to read, and
       the row keeps its old label rather than inventing one. */
    expect(toolSubject("read-file", "")).toBeNull();
    expect(toolSubject("read-file", "{ not json")).toBeNull();
    expect(toolSubject("read-file", json({}))).toBeNull();
    expect(toolSubject("record-concept", json({ title: "Tensors" }))).toBeNull();
  });
});

describe("baseName", () => {
  it("takes the last segment", () => {
    expect(baseName("src/main/store/projectStore.ts")).toBe("projectStore.ts");
    expect(baseName("main.py")).toBe("main.py");
  });

  it("ignores a trailing slash on a directory", () => {
    expect(baseName("src/lib/")).toBe("lib");
  });
});
