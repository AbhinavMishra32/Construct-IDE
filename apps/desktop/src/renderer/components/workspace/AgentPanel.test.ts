import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@construct/domain";
import { mergeMessages } from "./agentMessages";

const message = (id: string, body: string, createdAt: string): AgentMessage => ({
  id,
  role: "agent",
  body,
  createdAt,
  activity: [],
});

describe("agent transcript message reconciliation", () => {
  it("does not let a late database snapshot erase a live message", () => {
    const stored = [message("old", "Earlier", "2026-08-30T10:00:00.000Z")];
    const live = [message("new", "Just arrived", "2026-08-30T10:01:00.000Z")];

    expect(mergeMessages(stored, live).map((item) => item.body)).toEqual(["Earlier", "Just arrived"]);
  });

  it("updates the same durable message without drawing a duplicate", () => {
    const initial = message("turn", "Partial", "2026-08-30T10:00:00.000Z");
    const settled = message("turn", "Complete", "2026-08-30T10:00:00.000Z");

    expect(mergeMessages([initial], [settled])).toEqual([settled]);
  });
});
