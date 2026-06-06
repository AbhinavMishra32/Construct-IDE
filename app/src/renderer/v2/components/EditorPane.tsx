import { useEffect, useMemo, useRef, useState } from "react";

import type { EditBlock } from "../types";

export function EditorPane({
  path,
  content,
  activeEdit,
  editAnchor,
  editProgress,
  onFreeEdit,
  onGuidedProgress
}: {
  path: string | null;
  content: string;
  activeEdit: EditBlock | null;
  editAnchor: string;
  editProgress: number;
  onFreeEdit: (content: string) => void;
  onGuidedProgress: (progress: number) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [wrongInput, setWrongInput] = useState(false);
  const typed = activeEdit?.content.slice(0, editProgress) ?? "";
  const remaining = activeEdit?.content.slice(editProgress) ?? "";
  const isGuided = Boolean(activeEdit && activeEdit.path === path);
  const displayContent = isGuided ? editAnchor + typed : content;

  useEffect(() => {
    editorRef.current?.focus();
  }, [path, activeEdit?.id]);

  const lineCount = useMemo(
    () => Math.max(1, (displayContent + remaining).split("\n").length),
    [displayContent, remaining]
  );

  if (!path) {
    return (
      <section className="editor-pane editor-pane--empty">
        <p>Select a project file.</p>
      </section>
    );
  }

  if (!isGuided) {
    return (
      <section className="editor-pane">
        <div className="editor-pane__tab">{path}</div>
        <textarea
          className="editor-pane__textarea"
          spellCheck={false}
          value={content}
          onChange={(event) => onFreeEdit(event.target.value)}
        />
      </section>
    );
  }

  return (
    <section className="editor-pane">
      <div className="editor-pane__tab">{path}</div>
      <div
        ref={editorRef}
        className="ghost-editor"
        tabIndex={0}
        data-wrong={wrongInput ? "true" : "false"}
        onKeyDown={(event) => {
          if (!activeEdit) {
            return;
          }

          if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
          }

          if (event.key === "Backspace") {
            event.preventDefault();
            onGuidedProgress(Math.max(0, editProgress - 1));
            return;
          }

          const input = normalizeKey(event.key);
          if (input === null) {
            return;
          }

          event.preventDefault();

          if (activeEdit.content.slice(editProgress, editProgress + input.length) === input) {
            onGuidedProgress(editProgress + input.length);
            return;
          }

          setWrongInput(true);
          window.setTimeout(() => setWrongInput(false), 170);
        }}
      >
        <div className="ghost-editor__gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_item, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <pre className="ghost-editor__code">
          <span>{editAnchor}</span>
          <span>{typed}</span>
          <span className="ghost-editor__caret" />
          <span className="ghost-editor__ghost">{remaining}</span>
        </pre>
      </div>
    </section>
  );
}

function normalizeKey(key: string): string | null {
  if (key === "Enter") {
    return "\n";
  }

  if (key === "Tab") {
    return "  ";
  }

  if (key.length === 1) {
    return key;
  }

  return null;
}

