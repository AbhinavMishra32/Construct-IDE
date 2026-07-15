import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asideSocketDescriptor } from "./AsideConstructThread";

describe("Aside Construct thread bridge", () => {
  it("distinguishes the session subscription from the agent chat stream", () => {
    assert.deepEqual(
      asideSocketDescriptor("ws://127.0.0.1:21420/ws/sessions/project-1?accountId=1", "fallback"),
      { kind: "session-subscription", sessionId: "project-1" },
    );
    assert.deepEqual(
      asideSocketDescriptor("ws://127.0.0.1:21420/agents/chat/project-1", "fallback"),
      { kind: "chat", sessionId: "project-1" },
    );
  });
});
