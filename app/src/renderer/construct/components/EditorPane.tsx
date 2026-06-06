import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import { monaco } from "../../monaco";
import type { EditBlock } from "../types";

type GuidedState = {
  activeEdit: EditBlock | null;
  editProgress: number;
  onFreeEdit: (content: string) => void;
  onGuidedProgress: (progress: number) => void;
};

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
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const ghostDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const guidedStateRef = useRef<GuidedState>({
    activeEdit,
    editProgress,
    onFreeEdit,
    onGuidedProgress
  });
  const [wrongInput, setWrongInput] = useState(false);
  const typed = activeEdit?.content.slice(0, editProgress) ?? "";
  const remaining = activeEdit?.content.slice(editProgress) ?? "";
  const isGuided = Boolean(activeEdit && activeEdit.path === path);
  const displayContent = isGuided ? `${editAnchor}${typed}${remaining}` : content;

  useEffect(() => {
    guidedStateRef.current = {
      activeEdit,
      editProgress,
      onFreeEdit,
      onGuidedProgress
    };
  }, [activeEdit, editProgress, onFreeEdit, onGuidedProgress]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.updateOptions({
      readOnly: isGuided,
      readOnlyMessage: { value: "Type the highlighted ghost text manually to advance." }
    });

    if (!isGuided || !activeEdit) {
      ghostDecorationsRef.current?.clear();
      return;
    }

    const ghostStart = offsetToPosition(displayContent, editAnchor.length + typed.length);
    const ghostEnd = offsetToPosition(displayContent, displayContent.length);
    editor.setPosition(ghostStart);
    editor.revealPositionInCenterIfOutsideViewport(ghostStart);
    ghostDecorationsRef.current?.set(
      remaining.length > 0
        ? [
            {
              range: new monaco.Range(
                ghostStart.lineNumber,
                ghostStart.column,
                ghostEnd.lineNumber,
                ghostEnd.column
              ),
              options: {
                inlineClassName: "construct-monaco-ghost-text"
              }
            }
          ]
        : []
    );
    editor.focus();
  }, [activeEdit, displayContent, editAnchor.length, isGuided, remaining.length, typed.length]);

  const language = useMemo(() => languageForPath(path), [path]);

  if (!path) {
    return (
      <section className="editor-pane editor-pane--empty">
        <p>Select a project file.</p>
      </section>
    );
  }

  return (
    <section className="editor-pane" data-guided={isGuided ? "true" : "false"} data-wrong={wrongInput ? "true" : "false"}>
      <Editor
        key={`${path}:${activeEdit?.id ?? "free"}`}
        className="editor-pane__monaco"
        height="100%"
        language={language}
        options={{
          automaticLayout: true,
          cursorBlinking: "smooth",
          fontFamily: "var(--codex-font-mono)",
          fontLigatures: true,
          fontSize: 13,
          lineHeight: 21,
          minimap: { enabled: false },
          padding: { top: 14, bottom: 14 },
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on"
        }}
        theme="vs-dark"
        value={displayContent}
        onChange={(value) => {
          if (!isGuided) {
            onFreeEdit(value ?? "");
          }
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          ghostDecorationsRef.current = editor.createDecorationsCollection();
          editor.onKeyDown((event) => {
            const current = guidedStateRef.current;
            if (!current.activeEdit || current.activeEdit.path !== path) {
              return;
            }

            if (event.metaKey || event.ctrlKey || event.altKey) {
              return;
            }

            if (event.keyCode === monaco.KeyCode.Backspace) {
              event.preventDefault();
              current.onGuidedProgress(Math.max(0, current.editProgress - 1));
              return;
            }

            const input = normalizeMonacoKey(event);
            if (input === null) {
              return;
            }

            event.preventDefault();

            if (current.activeEdit.content.slice(current.editProgress, current.editProgress + input.length) === input) {
              current.onGuidedProgress(current.editProgress + input.length);
              return;
            }

            setWrongInput(true);
            window.setTimeout(() => setWrongInput(false), 170);
          });
          editor.focus();
        }}
      />
    </section>
  );
}

function normalizeMonacoKey(event: monaco.IKeyboardEvent): string | null {
  if (event.keyCode === monaco.KeyCode.Enter) {
    return "\n";
  }

  if (event.keyCode === monaco.KeyCode.Tab) {
    return "  ";
  }

  if (event.browserEvent.key.length === 1) {
    return event.browserEvent.key;
  }

  return null;
}

function offsetToPosition(text: string, offset: number) {
  const lines = text.slice(0, offset).split("\n");
  return {
    lineNumber: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

function languageForPath(path: string | null) {
  if (!path) {
    return "plaintext";
  }

  if (/\.(tsx)$/.test(path)) return "typescript";
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.(jsx)$/.test(path)) return "javascript";
  if (/\.(js|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.css$/.test(path)) return "css";
  if (/\.s[ac]ss$/.test(path)) return "scss";
  if (/\.html?$/.test(path)) return "html";
  if (/\.mdx?$/.test(path)) return "markdown";
  if (/\.ya?ml$/.test(path)) return "yaml";
  if (/\.sql$/.test(path)) return "sql";
  if (/\.sh$/.test(path)) return "shell";
  if (/\.py$/.test(path)) return "python";

  return "plaintext";
}
