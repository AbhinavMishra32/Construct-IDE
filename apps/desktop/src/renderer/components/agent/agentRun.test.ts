import { describe, expect, it } from "vitest";

import type { AgentStreamEvent } from "../../../shared/api";
import { reduceRun, type AgentRun } from "./agentRun";

/**
 * The transcript, folded from the stream.
 *
 * These cover the shape the worker now sends: token deltas as the model writes
 * them, interleaved with the tool rows `hostTool` emits the moment a tool is
 * called. The bug this guards is the one the old `generate` + `onStepFinish`
 * pipeline had — the prose that introduced a tool call arrived *after* the tool
 * had already run and been drawn, so the transcript read backwards.
 */
const event = (partial: Partial<AgentStreamEvent>): AgentStreamEvent =>
  ({ runId: "run-1", type: "text", ...partial }) as AgentStreamEvent;

const fold = (events: AgentStreamEvent[]): AgentRun => {
  let run: AgentRun | null = null;
  for (const next of events) run = reduceRun(run, next);
  if (!run) throw new Error("the reducer produced no run");
  return run;
};

describe("folding the agent stream", () => {
  it("grows one message from token deltas rather than a part per token", () => {
    const run = fold([
      event({ text: "Let me " }),
      event({ text: "see where " }),
      event({ text: "we are." }),
    ]);

    expect(run.parts).toHaveLength(1);
    expect(run.parts[0]).toMatchObject({ kind: "text", body: "Let me see where we are." });
    expect(run.status).toBe("streaming");
  });

  it("keeps prose before the tool it introduced", () => {
    const run = fold([
      event({ text: "Let me read the file." }),
      event({ type: "tool", tool: "read-file", callId: "c1", phase: "start", input: "{}" }),
      event({ type: "tool", tool: "read-file", callId: "c1", phase: "end", ok: true, output: "{}" }),
      event({ text: "It defines one function." }),
    ]);

    /* The order is the assertion. Under the old pipeline the tool row landed
       first and both sentences arrived afterwards, glued together. */
    expect(run.parts.map((part) => part.kind)).toEqual(["text", "tool", "text"]);
    expect(run.parts[0]).toMatchObject({ body: "Let me read the file." });
    expect(run.parts[2]).toMatchObject({ body: "It defines one function." });
  });

  it("updates a tool row in place rather than drawing a second one", () => {
    const run = fold([
      event({ type: "tool", tool: "list-files", callId: "c1", phase: "start", input: "{}" }),
      event({ type: "tool", tool: "list-files", callId: "c1", phase: "end", ok: true, output: "[]" }),
    ]);

    expect(run.parts).toHaveLength(1);
    expect(run.parts[0]).toMatchObject({ kind: "tool", phase: "done" });
  });

  it("closes an open reasoning block when the answer starts", () => {
    const run = fold([
      event({ type: "reasoning", text: "The file is small, " }),
      event({ type: "reasoning", text: "so reading it is cheap." }),
      event({ text: "Reading it now." }),
    ]);

    const reasoning = run.parts.find((part) => part.kind === "reasoning");
    expect(reasoning).toMatchObject({ body: "The file is small, so reading it is cheap.", open: false });
    expect(run.parts.at(-1)).toMatchObject({ kind: "text", body: "Reading it now." });
  });

  it("keeps a question's preamble, which used to be dropped with its step", () => {
    /* A turn that ends on a question never finishes its step. The old pipeline
       emitted text from `onStepFinish`, so this sentence never arrived and the
       learner saw a bare question with nothing to read. */
    const run = fold([
      event({ text: "Given dim3(3) blocks and dim3(4) threads:" }),
      event({ type: "tool", tool: "ask_user_question", callId: "q1", phase: "start", input: "{}" }),
    ]);

    expect(run.parts[0]).toMatchObject({ kind: "text", body: "Given dim3(3) blocks and dim3(4) threads:" });
    expect(run.parts[1]).toMatchObject({ kind: "tool", phase: "running" });
  });

  it("gathers a burst of reasoning fragments into one thought", () => {
    /* The regression this guards: providers emit a start/delta/end triple per
       reasoning *part*, dozens per turn. Forwarding every end drew a separate
       "Thought for 1s" row holding two or three words each. */
    const run = fold([
      event({ type: "reasoning", text: "explain" }),
      event({ type: "reasoning", text: " simply" }),
      event({ type: "reasoning", text: ". Let me record" }),
      event({ type: "reasoning", text: " the concept" }),
    ]);

    expect(run.parts).toHaveLength(1);
    expect(run.parts[0]).toMatchObject({
      kind: "reasoning",
      body: "explain simply. Let me record the concept",
    });
  });

  it("keeps earlier reasoning when a later reasoning block starts", () => {
    const run = fold([
      event({ type: "reasoning", text: "First thought" }),
      event({ text: "A progress note." }),
      event({ type: "reasoning", text: "Second thought" }),
    ]);

    expect(run.parts).toMatchObject([
      { kind: "reasoning", body: "First thought" },
      { kind: "text", body: "A progress note." },
      { kind: "reasoning", body: "Second thought" },
    ]);
  });

  it("starts a fresh run when the run id changes", () => {
    const first = fold([event({ text: "old turn" })]);
    const second = reduceRun(first, event({ runId: "run-2", text: "new turn" }));

    expect(second?.runId).toBe("run-2");
    expect(second?.parts).toHaveLength(1);
    expect(second?.parts[0]).toMatchObject({ body: "new turn" });
  });
});
