import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("FlowWorkspace task lifecycle rendering", () => {
  it("renders failed practice-task drafts without a persistent creating spinner", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /const failed = !ready && status === "error"/);
    assert.match(source, /Task failed/);
    assert.match(source, /failed \?\s*\(?\s*<CircleAlertIcon size=\{isPanel \? 13 : 14\} \/>\s*\)?\s*:\s*status === "running" \?\s*\(?\s*<Loader2Icon size=\{isPanel \? 13 : 14\} className="animate-spin" \/>\s*\)?\s*:\s*\(?\s*<TerminalIcon size=\{isPanel \? 13 : 14\} \/>\s*\)?/);
  });
});
