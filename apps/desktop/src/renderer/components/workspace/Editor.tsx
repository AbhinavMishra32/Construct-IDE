import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { languageForPath } from "@construct/domain";
import { EDITOR_THEME_DARK, EDITOR_THEME_LIGHT } from "@/lib/monaco-theme";

type Props = {
  path: string;
  content: string;
  onChange(value: string): void;
};

/**
 * One Monaco instance, reused across files.
 *
 * Files are held as Monaco models keyed by path rather than by swapping the
 * editor's value: a model carries its own undo history and cursor position, so
 * switching to another file and back returns to where the learner was instead
 * of a fresh buffer at line one.
 *
 * The editor itself is created once. Disposing and recreating it per file is
 * what makes an editor flicker on every tab change.
 */
export function Editor({ path, content, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!host.current || editor.current) return;

    editor.current = monaco.editor.create(host.current, {
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      smoothScrolling: true,
      padding: { top: 12 },
      theme: document.documentElement.classList.contains("dark") ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT,
    });

    const subscription = editor.current.onDidChangeModelContent(() => {
      const value = editor.current?.getValue();
      if (value !== undefined) latest.current(value);
    });

    return () => {
      subscription.dispose();
      editor.current?.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor.current) return;

    const uri = monaco.Uri.parse(`construct:///${path}`);
    const existing = monaco.editor.getModel(uri);
    const model = existing ?? monaco.editor.createModel(content, languageForPath(path) ?? "plaintext", uri);

    /* A model already open is reused as it stands. Overwriting it with what was
       just read from disk would throw away edits the learner has not saved and
       reset their undo history with them. */
    if (editor.current.getModel() !== model) editor.current.setModel(model);
  }, [path, content]);

  /* The theme is global to Monaco, not per editor, so it follows the document
     class the rest of the interface is themed by. */
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => monaco.editor.setTheme(root.classList.contains("dark") ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT);
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <div ref={host} className="h-full min-h-0 w-full" />;
}
