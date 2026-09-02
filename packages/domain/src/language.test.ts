import { describe, expect, it } from "vitest";
import { languageForPath } from "./language.js";

describe("languageForPath", () => {
  it("names the languages Construct can open", () => {
    expect(languageForPath("src/main.ts")).toBe("typescript");
    expect(languageForPath("src/App.tsx")).toBe("typescript");
    expect(languageForPath("scripts/build.mjs")).toBe("javascript");
    expect(languageForPath("agent/policy.py")).toBe("python");
    expect(languageForPath("engine/render.cpp")).toBe("cpp");
  });

  it("returns null rather than guessing for files that are not source", () => {
    expect(languageForPath("README.md")).toBeNull();
    expect(languageForPath("pnpm-lock.yaml")).toBeNull();
    expect(languageForPath("Makefile")).toBeNull();
  });

  it("ignores extension casing, which Windows checkouts produce", () => {
    expect(languageForPath("Legacy/Main.PY")).toBe("python");
  });
});
