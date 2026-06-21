import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

describe("FlowWorkspace task lifecycle rendering", () => {
  it("renders failed practice-task drafts without a persistent creating spinner", () => {
    const source = readFileSync(fileURLToPath(new URL("./FlowWorkspace.tsx", import.meta.url)), "utf8");

    assert.match(source, /const failed = !ready && status === "error"/);
    assert.match(source, /Task failed/);
    assert.match(source, /failed \? "Failed" : "Creating"/);
    assert.match(source, /failed \? <CircleAlertIcon size=\{12\} \/> : <Loader2Icon size=\{12\} className="animate-spin" \/>/);
    assert.match(source, /tone=\{failed \? "danger" : "strong"\}/);
  });
});
