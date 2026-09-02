import { describe, expect, it } from "vitest";

import type { WorkspaceEntry } from "../../../shared/api";
import { canDrop } from "./FileTree";

const file = (path: string): WorkspaceEntry => ({ name: path.slice(path.lastIndexOf("/") + 1), path, type: "file" });
const dir = (path: string): WorkspaceEntry => ({ name: path.slice(path.lastIndexOf("/") + 1), path, type: "directory" });

describe("canDrop", () => {
  it("accepts a file into another folder", () => {
    expect(canDrop(file("main.ts"), "src")).toBe(true);
    expect(canDrop(file("src/main.ts"), "lib")).toBe(true);
  });

  it("accepts a file dragged out to the project root", () => {
    expect(canDrop(file("src/main.ts"), "")).toBe(true);
  });

  it("refuses a drop into the folder it already sits in", () => {
    /* Not an error, just nothing — but it must not light up as a target, or
       every drag would suggest a move that does not exist. */
    expect(canDrop(file("src/main.ts"), "src")).toBe(false);
    expect(canDrop(file("main.ts"), "")).toBe(false);
  });

  it("refuses a folder into itself", () => {
    expect(canDrop(dir("src"), "src")).toBe(false);
  });

  it("refuses a folder into its own descendant", () => {
    /* The one that actually destroys something: moving a folder inside itself
       takes the destination with it. */
    expect(canDrop(dir("src"), "src/lib")).toBe(false);
    expect(canDrop(dir("src"), "src/lib/deep")).toBe(false);
  });

  it("does not confuse a sibling whose name shares a prefix", () => {
    /* `src` must not be treated as containing `srclib`. */
    expect(canDrop(dir("src"), "srclib")).toBe(true);
  });

  it("accepts a folder into an unrelated folder", () => {
    expect(canDrop(dir("src/lib"), "vendor")).toBe(true);
  });
});
