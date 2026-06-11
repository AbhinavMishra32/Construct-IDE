import assert from "node:assert/strict";
import test from "node:test";

import {
  activateDocument,
  closeDocument,
  consumeDocumentReveal,
  createDocumentSession,
  revealDocument,
} from "./documentSession";

test("document sessions deduplicate tabs and activate existing documents", () => {
  const initial = createDocumentSession("src/a.ts");
  const opened = activateDocument(activateDocument(initial, "src/b.ts"), "src/a.ts");

  assert.deepEqual(opened.tabs, ["src/a.ts", "src/b.ts"]);
  assert.equal(opened.activePath, "src/a.ts");
});

test("closing the active document selects its nearest neighbor", () => {
  const session = activateDocument(activateDocument(createDocumentSession("a.ts"), "b.ts"), "c.ts");

  assert.equal(closeDocument(session, "b.ts").activePath, "c.ts");
  assert.equal(closeDocument(session, "c.ts").activePath, "b.ts");
});

test("reveal requests are file scoped and consumed by id", () => {
  const revealed = revealDocument(createDocumentSession("a.ts"), {
    kind: "focus",
    path: "src/target.ts",
    line: 9,
    endLine: 14,
  });

  assert.equal(revealed.activePath, "src/target.ts");
  assert.equal(revealed.reveal?.path, "src/target.ts");
  assert.equal(consumeDocumentReveal(revealed, 999).reveal?.line, 9);
  assert.equal(consumeDocumentReveal(revealed, revealed.reveal!.id).reveal, null);
});
