import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeNativeCommandError } from "./tauriBridge";

describe("Tauri command error normalization", () => {
  it("turns serialized Rust CommandError payloads into JavaScript errors", () => {
    const error = normalizeNativeCommandError({
      code: "settings.models",
      message: "model lookup failed: 401 Unauthorized",
    });

    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "settings.models: model lookup failed: 401 Unauthorized",
    );
    assert.notEqual(String(error), "[object Object]");
  });

  it("preserves real errors and normalizes string or unknown failures", () => {
    const existing = new Error("already normalized");

    assert.equal(normalizeNativeCommandError(existing), existing);
    assert.equal(normalizeNativeCommandError(" network unavailable ").message, "network unavailable");
    assert.equal(normalizeNativeCommandError({ code: "settings.models" }).message, "Native command failed.");
    assert.equal(normalizeNativeCommandError(null).message, "Native command failed.");
  });
});
