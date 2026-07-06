import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLspLanguage, resolveLspInstallCommand } from "./ConstructLspService";

describe("ConstructLspService install command resolution", () => {
  it("keeps single-language Rust installs on rustup instead of the aggregate npm installer", () => {
    const command = resolveLspInstallCommand("rust") ?? "";

    assert.match(command, /command -v rustup/);
    assert.match(command, /rustup component add rust-analyzer/);
    assert.match(command, /brew install rust-analyzer/);
    assert.doesNotMatch(command, /npm install/);
  });

  it("keeps npm-managed language servers on a deduplicated npm install command", () => {
    assert.equal(
      resolveLspInstallCommand("typescript"),
      "npm install --save-dev typescript-language-server typescript",
    );
    assert.equal(
      resolveLspInstallCommand("json"),
      "npm install --save-dev vscode-langservers-extracted",
    );
  });

  it("validates IPC language ids at runtime", () => {
    assert.equal(isLspLanguage("rust"), true);
    assert.equal(isLspLanguage("javascript"), false);
    assert.equal(isLspLanguage(undefined), false);
  });
});
