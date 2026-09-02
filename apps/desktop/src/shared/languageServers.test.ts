import { describe, expect, it } from "vitest";

import { LANGUAGE_SERVERS, currentPlatform, serverById, serverForPath } from "./languageServers.js";

describe("the language server catalog", () => {
  it("gives every entry a unique id", () => {
    const ids = LANGUAGE_SERVERS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* Ordering is the only thing that decides a contested extension, so a second
     claim on one is a bug that would otherwise show up as the wrong server
     silently starting. */
  it("never lets two entries claim the same extension", () => {
    const seen = new Map<string, string>();
    for (const entry of LANGUAGE_SERVERS) {
      for (const extension of entry.extensions) {
        expect(seen.get(extension) ?? entry.id).toBe(entry.id);
        seen.set(extension, entry.id);
      }
    }
  });

  it("describes every entry well enough to render a settings row", () => {
    for (const entry of LANGUAGE_SERVERS) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.blurb.length).toBeGreaterThan(0);
      expect(entry.languages.length).toBeGreaterThan(0);
      expect(entry.extensions.length).toBeGreaterThan(0);
    }
  });

  it("finds itself by id", () => {
    expect(serverById("python")?.languages).toContain("python");
    expect(serverById("nothing-like-this")).toBeNull();
  });
});

describe("choosing a server for a file", () => {
  it("matches on the extension, case and directory aside", () => {
    expect(serverForPath("src/main.py")?.id).toBe("python");
    expect(serverForPath("/tmp/Deep/Path/Component.TSX")?.id).toBe("typescript");
    expect(serverForPath("windows\\style\\path.rs")?.id).toBe("rust-analyzer");
  });

  it("shares one server between the languages that share one", () => {
    expect(serverForPath("a.js")?.id).toBe(serverForPath("b.ts")?.id);
  });

  it("recognises a Dockerfile, which has no extension at all", () => {
    expect(serverForPath("Dockerfile")?.id).toBe("docker");
    expect(serverForPath("deploy/Dockerfile.web")?.id).toBe("docker");
  });

  it("claims nothing it does not know", () => {
    expect(serverForPath("notes.wat")).toBeNull();
    expect(serverForPath("LICENSE")).toBeNull();
    expect(serverForPath("")).toBeNull();
  });
});

describe("recognising this machine", () => {
  it("names the platforms that have release assets", () => {
    expect(currentPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentPlatform("linux", "x64")).toBe("linux-x64");
    expect(currentPlatform("win32", "x64")).toBe("win32-x64");
  });

  it("returns nothing for a machine no release targets", () => {
    expect(currentPlatform("freebsd", "x64")).toBeNull();
    expect(currentPlatform("win32", "arm64")).toBeNull();
  });
});
