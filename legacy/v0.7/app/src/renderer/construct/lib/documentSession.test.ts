import assert from "node:assert/strict";
import test from "node:test";

import {
  activateDocument,
  closeDocument,
  consumeDocumentReveal,
  createDocumentSession,
  replaceDocumentPath,
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

test("renaming a document preserves active state and deduplicates tabs", () => {
  const session = revealDocument(
    activateDocument(activateDocument(createDocumentSession("a.ts"), "b.ts"), "renamed.ts"),
    { kind: "focus", path: "b.ts", line: 3 },
  );

  const renamed = replaceDocumentPath(session, "b.ts", "renamed.ts");

  assert.equal(renamed.activePath, "renamed.ts");
  assert.equal(renamed.reveal?.path, "renamed.ts");
  assert.deepEqual(renamed.tabs, ["a.ts", "renamed.ts"]);
});
