import { describe, expect, it } from "vitest";
import type { AgentActivityStep } from "@construct/domain";
import { replayTurn, settleTurnActivity } from "./turnRecord.js";

const step = (kind: AgentActivityStep["kind"], text: string): AgentActivityStep => ({
  kind,
  tool: kind === "tool" ? "read-file" : "",
  label: "",
  actionTitle: "",
  detail: "",
  ok: true,
  text,
  seconds: 0,
  input: "",
  output: "",
});

describe("settling a streamed turn for storage", () => {
  it("moves only the trailing prose block into the message body", () => {
    const settled = settleTurnActivity(
      [step("note", "I will inspect it."), step("tool", ""), step("note", "Here is the answer.")],
      "Here is the answer.",
    );

    expect(settled.body).toBe("Here is the answer.");
    expect(settled.activity.map((item) => item.kind)).toEqual(["note", "tool"]);
  });

  it("keeps pre-tool prose ordered and does not duplicate it as a body", () => {
    const settled = settleTurnActivity(
      [step("note", "I will inspect it."), step("tool", "")],
      "I will inspect it.",
    );

    expect(settled.body).toBe("");
    expect(settled.activity.map((item) => item.kind)).toEqual(["note", "tool"]);
  });
});

const call = (tool: string, label: string, detail: string, ok = true): AgentActivityStep => ({
  kind: "tool",
  tool,
  label,
  actionTitle: "",
  detail,
  ok,
  text: "",
  seconds: 0,
  input: "",
  output: "",
});

describe("replaying an earlier turn to the next one", () => {
  it("carries the calls the turn made, not only what it said", () => {
    const replayed = replayTurn({
      body: "Torch is not installed yet.",
      activity: [call("run-command", "python -c \"import torch\"", "ModuleNotFoundError: No module named 'torch'")],
    });

    expect(replayed).toContain("Torch is not installed yet.");
    expect(replayed).toContain("run-command");
    expect(replayed).toContain("ModuleNotFoundError");
  });

  it("replays a stopped turn that worked without ever speaking", () => {
    const replayed = replayTurn({ body: "", activity: [call("read-file", "main.py", "42 lines")] });

    /* This is the whole point: an aborted turn used to come back as an empty
       assistant message, so the next turn read the file all over again. */
    expect(replayed.trim()).not.toBe("");
    expect(replayed).toContain("main.py");
  });

  it("marks a call that failed, so it is not read as an established fact", () => {
    expect(replayTurn({ body: "", activity: [call("run-command", "pip install torch", "exit 1", false)] })).toContain("failed:");
  });

  it("leaves reasoning out", () => {
    expect(replayTurn({ body: "Done.", activity: [step("reasoning", "I wonder whether they already know this.")] })).toBe("Done.");
  });

  it("is just the body when the turn called nothing", () => {
    expect(replayTurn({ body: "Try running it.", activity: [] })).toBe("Try running it.");
  });
});
