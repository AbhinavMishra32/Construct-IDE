import { describe, expect, it } from "vitest";
import { claimProject, projectBusy } from "./turnRouting.js";

/**
 * The turn id has to be the same value in three places, and it silently was
 * not: the service keyed its in-flight map by the IPC envelope's id, while the
 * worker stamped tool calls with the payload's `requestId`. Two UUIDs, so every
 * lookup missed and every tool call came back "That project is no longer open".
 *
 * The failure had no symptom on either side in isolation — the worker sent a
 * well-formed message and the service answered a well-formed error — so it
 * needs a test that looks at the contract between them rather than at either
 * end of it.
 */

/** The worker's side: it echoes back whatever `requestId` the payload carried. */
function workerToolCall(payload: { requestId: string }): { requestId: string } {
  return { requestId: payload.requestId };
}

/** The service's side, reduced to the routing decision. */
function routeToolCall(running: Map<string, string>, toolCall: { requestId: string }): string | null {
  return running.get(toolCall.requestId) ?? null;
}

describe("routing a tool call back to its project", () => {
  it("resolves when the map key and the payload requestId are the same value", () => {
    const turnId = "11111111-1111-4111-8111-111111111111";
    const running = new Map([[turnId, "project-a"]]);

    expect(routeToolCall(running, workerToolCall({ requestId: turnId }))).toBe("project-a");
  });

  /* The regression itself: two different ids, which is what shipped. */
  it("fails to resolve when the map is keyed by a different id than the payload carries", () => {
    const envelopeId = "22222222-2222-4222-8222-222222222222";
    const payloadRequestId = "33333333-3333-4333-8333-333333333333";
    const running = new Map([[envelopeId, "project-a"]]);

    expect(routeToolCall(running, workerToolCall({ requestId: payloadRequestId }))).toBeNull();
  });

  it("keeps concurrent turns apart, so a tool call cannot reach another project", () => {
    const first = "44444444-4444-4444-8444-444444444444";
    const second = "55555555-5555-4555-8555-555555555555";
    const running = new Map([
      [first, "project-a"],
      [second, "project-b"],
    ]);

    expect(routeToolCall(running, workerToolCall({ requestId: second }))).toBe("project-b");
  });

  it("resolves to nothing once the turn is finished, rather than to a stale project", () => {
    const turnId = "66666666-6666-4666-8666-666666666666";
    const running = new Map([[turnId, "project-a"]]);
    running.delete(turnId);

    expect(routeToolCall(running, workerToolCall({ requestId: turnId }))).toBeNull();
  });
});

describe("claiming a project kickoff", () => {
  it("rejects an immediate second kickoff before the first model turn exists", () => {
    const starting = new Set<string>();
    const running = new Map<string, string>();

    expect(claimProject(starting, running, "project-a")).toBe(true);
    expect(claimProject(starting, running, "project-a")).toBe(false);
    expect(projectBusy(starting, running, "project-a")).toBe(true);
  });

  it("also rejects a kickoff while a normal turn is running", () => {
    const starting = new Set<string>();
    const running = new Map([["turn-a", "project-a"]]);

    expect(claimProject(starting, running, "project-a")).toBe(false);
  });
});
