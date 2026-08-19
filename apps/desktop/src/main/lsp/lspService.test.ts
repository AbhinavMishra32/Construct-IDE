import { describe, expect, it } from "vitest";
import { __test } from "./lspService.js";

const frame = (payload: unknown) => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8"), body]);
};

const drainAll = (buffer: Buffer) => {
  const session = { buffer };
  const messages = [...__test.drain(session)];
  return { messages, remaining: session.buffer };
};

describe("framing", () => {
  it("reads one whole message", () => {
    const { messages, remaining } = drainAll(frame({ jsonrpc: "2.0", id: 1, result: null }));

    expect(messages).toEqual([{ jsonrpc: "2.0", id: 1, result: null }]);
    expect(remaining.byteLength).toBe(0);
  });

  it("reads several messages arriving in one chunk", () => {
    const { messages } = drainAll(Buffer.concat([frame({ id: 1 }), frame({ id: 2 }), frame({ id: 3 })]));
    expect(messages).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  /* The failure this guards is the common one: a read boundary landing inside
     a message. Waiting is correct; parsing what has arrived is not. */
  it("waits when a body is only half here, then completes it", () => {
    const whole = frame({ id: 7, method: "textDocument/publishDiagnostics" });
    const session = { buffer: whole.subarray(0, whole.byteLength - 5) };

    expect([...__test.drain(session)]).toEqual([]);

    session.buffer = Buffer.concat([session.buffer, whole.subarray(whole.byteLength - 5)]);
    expect([...__test.drain(session)]).toEqual([{ id: 7, method: "textDocument/publishDiagnostics" }]);
  });

  it("waits when the header itself is split", () => {
    const whole = frame({ id: 9 });
    const session = { buffer: whole.subarray(0, 8) };

    expect([...__test.drain(session)]).toEqual([]);

    session.buffer = Buffer.concat([session.buffer, whole.subarray(8)]);
    expect([...__test.drain(session)]).toEqual([{ id: 9 }]);
  });

  it("measures bytes rather than characters, so non-ASCII does not desynchronise the stream", () => {
    const payload = { message: "variable 'café' är inte definierad — 変数" };
    const { messages, remaining } = drainAll(Buffer.concat([frame(payload), frame({ id: 2 })]));

    expect(messages).toEqual([payload, { id: 2 }]);
    expect(remaining.byteLength).toBe(0);
  });

  it("skips a malformed body instead of stalling the stream", () => {
    const bad = Buffer.from("Content-Length: 3\r\n\r\n{{{", "utf8");
    const { messages } = drainAll(Buffer.concat([bad, frame({ id: 4 })]));

    expect(messages).toEqual([{ id: 4 }]);
  });

  it("drops a header with no Content-Length rather than spinning on it", () => {
    const junk = Buffer.from("X-Nonsense: 1\r\n\r\n", "utf8");
    const { messages } = drainAll(Buffer.concat([junk, frame({ id: 5 })]));

    expect(messages).toEqual([{ id: 5 }]);
  });
});
