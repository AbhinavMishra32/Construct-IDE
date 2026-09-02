import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { dressEditorWidgets } from "@/lib/monaco/shadowStyles";

type Props = {
  /** Absolute path of the project the file lives in. */
  directory: string;
  path: string;
  content: string;
  /** True for a file outside the project — a definition followed into
   *  node_modules or a language's own standard library. Those are shown, not
   *  edited: there is nowhere to save them that would be the learner's. */
  readOnly?: boolean;
  /** Where to put the cursor once the file is up, if it was opened by following
   *  something rather than by clicking it. A new object every time, so asking
   *  twice for the same line still scrolls there. */
  reveal?: { selection: monaco.IRange } | null;
  onChange(value: string): void;
};

/** The URI a file is addressed by, everywhere.
 *
 *  A real `file://` URI rather than the `construct:///` scheme this used to
 *  invent. Language servers are told about documents by URI, and a scheme they
 *  have never heard of naming a path that is not where the file is meant the
 *  client had to translate in both directions and could only ever answer for
 *  files that happened to be open. */
export const modelUri = (directory: string, path: string) =>
  /* An absolute path is already the whole answer — that is a file outside the
     project, reached by following a definition. */
  monaco.Uri.file(path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? path : `${directory}/${path}`);

/**
 * One editor instance, reused across files.
 *
 * Files are held as models keyed by path rather than by swapping the editor's
 * value: a model carries its own undo history and cursor position, so switching
 * to another file and back returns to where the learner was instead of a fresh
 * buffer at line one.
 *
 * The editor itself is created once. Disposing and recreating it per file is
 * what makes an editor flicker on every tab change.
 */
export function Editor({ directory, path, content, readOnly = false, reveal = null, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!host.current || editor.current) return;

    /* Almost nothing is passed here any more. Font, minimap, scrolling and the
       theme are user configuration — the same file the language client's own
       settings live in — so that one place decides how code looks. */
    editor.current = monaco.editor.create(host.current, {
      automaticLayout: true,
      padding: { top: 12 },
    });

    const subscription = editor.current.onDidChangeModelContent(() => {
      const value = editor.current?.getValue();
      if (value !== undefined) latest.current(value);
    });

    /* Purely cosmetic, and it has to be here: the editor's context menus are
       rendered into a shadow root of its own making, which the app's stylesheet
       cannot reach. This is what carries the window's material across.

       The host element, not `getDomNode()` — the editor has no model yet at this
       point in the effect, and `getDomNode` answers `null` until it does. */
    const undress = dressEditorWidgets(host.current);

    return () => {
      undress();
      subscription.dispose();
      editor.current?.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor.current) return;

    const uri = modelUri(directory, path);
    /* No language argument. The languages service resolves one from the URI,
       against every grammar the platform has registered — which is a longer
       list than the handful of extensions Construct itself names. */
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, undefined, uri);

    /* A model already open is reused as it stands. Overwriting it with what was
       just read from disk would throw away edits the learner has not saved and
       reset their undo history with them. */
    if (editor.current.getModel() !== model) editor.current.setModel(model);
    editor.current.updateOptions({ readOnly });
  }, [directory, path, content, readOnly]);

  /* Revealing is its own effect, and runs after the model is in place. A
     definition names a line in a file that may not have been open a moment ago,
     so the scroll cannot happen until the editor is actually showing it. */
  useEffect(() => {
    if (!editor.current || !reveal) return;
    editor.current.setSelection(reveal.selection);
    editor.current.revealRangeInCenterIfOutsideViewport(reveal.selection, monaco.editor.ScrollType.Immediate);
    editor.current.focus();
  }, [reveal]);

  /* No theme effect here any more. The palette is global and shared with the
     transcript, so `CodeThemeProvider` owns it: it rewrites the one
     configuration whenever the appearance or the chosen palette changes, and
     every open editor repaints. Two places setting the theme was how the editor
     came to disagree with the rest of the window. */

  return <div ref={host} className="h-full min-h-0 w-full" />;
}
