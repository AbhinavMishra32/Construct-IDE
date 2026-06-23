import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import { monaco } from "../../monaco";
import { lspClient } from "../lib/lspClient";
import { emitConstructSelectionContext, excerptLines, normalizeSelectionText } from "../lib/selectionContext";
import { initializeCodeGhost, disposeCodeGhost } from "../lib/codeGhostManager";
import {
  CONSTRUCT_DARK,
  CONSTRUCT_LIGHT,
  registerConstructThemes
} from "../editorThemes";
import type { EditBlock } from "../types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent
} from "@opaline/ui";
import {
  ArrowSquareOut,
  Eye,
  MagnifyingGlass,
  PencilSimpleLine,
  Stack,
  TextAlignLeft,
  Terminal
} from "@phosphor-icons/react";

registerConstructThemes();

function useEditorTheme(appTheme: "light" | "dark" | "system") {
  const [dark, setDark] = useState(() => {
    if (appTheme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return appTheme === "dark";
  });

  useEffect(() => {
    if (appTheme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (event: MediaQueryListEvent) => setDark(event.matches);
      mql.addEventListener("change", handler);
      setDark(mql.matches);
      return () => mql.removeEventListener("change", handler);
    } else {
      setDark(appTheme === "dark");
    }
  }, [appTheme]);

  return dark ? CONSTRUCT_DARK : CONSTRUCT_LIGHT;
}

type GuidedState = {
  activeEdit: EditBlock | null;
  editProgress: number;
  onFreeEdit: (content: string) => void;
  onGuidedProgress: (progress: number) => void;
  onRevealLine: () => void;
};

export function EditorPane({
  path,
  workspacePath,
  content,
  activeEdit,
  editAnchor,
  editProgress,
  onFreeEdit,
  onGuidedProgress,
  onRevealLine,
  onSave,
  theme,
  pendingJump = null,
  focusRange = null,
  onJumpComplete,
  onOpenFileAndJump
}: {
  path: string | null;
  workspacePath: string;
  content: string;
  activeEdit: EditBlock | null;
  editAnchor: string;
  editProgress: number;
  onFreeEdit: (content: string) => void;
  onGuidedProgress: (progress: number) => void;
  onRevealLine: () => void;
  onSave?: () => void;
  theme: "light" | "dark" | "system";
  pendingJump?: { line: number; column: number } | null;
  focusRange?: { line: number; endLine?: number; column?: number; hint?: string } | null;
  onJumpComplete?: () => void;
  onOpenFileAndJump?: (path: string, line: number, column: number) => void;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const ghostDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const focusDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const editorDisposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const restoreCodeEditorServiceRef = useRef<(() => void) | null>(null);
  const pathRef = useRef(path);
  const saveRef = useRef(onSave);
  const openFileAndJumpRef = useRef(onOpenFileAndJump);
  const guidedStateRef = useRef<GuidedState>({
    activeEdit,
    editProgress,
    onFreeEdit,
    onGuidedProgress,
    onRevealLine
  });
  const [wrongInput, setWrongInput] = useState(false);
  const [buttonTop, setButtonTop] = useState<number | null>(null);
  const [showSkipButton, setShowSkipButton] = useState(false);
  const editorTheme = useEditorTheme(theme);

  pathRef.current = path;
  saveRef.current = onSave;
  openFileAndJumpRef.current = onOpenFileAndJump;



  const triggerAction = useCallback((actionId: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.trigger("keyboard", actionId, null);
    }
  }, []);

  const os = useMemo(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "mac";
    if (ua.includes("win")) return "windows";
    if (ua.includes("linux")) return "linux";
    return "windows";
  }, []);


  const localProgressRef = useRef(editProgress);
  const lastSentProgressRef = useRef(editProgress);
  const lastRevealedLineRef = useRef<number | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const typed = activeEdit?.content.slice(0, editProgress) ?? "";
  const remaining = activeEdit?.content.slice(editProgress) ?? "";
  const isGuided = Boolean(activeEdit && activeEdit.path === path);
  const displayContent = isGuided ? `${editAnchor}${typed}${remaining}` : content;
  const language = useMemo(() => languageForPath(path), [path]);
  const totalLines = useMemo(() => {
    if (!activeEdit) return 0;
    return activeEdit.content.split("\n").length;
  }, [activeEdit]);
  const typedLines = useMemo(() => {
    if (!activeEdit) return 0;
    const typedText = activeEdit.content.slice(0, editProgress);
    return typedText.split("\n").length;
  }, [activeEdit, editProgress]);
  const percent = useMemo(() => {
    if (!activeEdit || activeEdit.content.length === 0) return 0;
    return Math.round((editProgress / activeEdit.content.length) * 100);
  }, [activeEdit, editProgress]);

  const updateProgress = useCallback((progress: number) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    if (activeEdit && progress >= activeEdit.content.length) {
      lastSentProgressRef.current = progress;
      guidedStateRef.current.onGuidedProgress(progress);
    } else {
      debounceTimeoutRef.current = setTimeout(() => {
        lastSentProgressRef.current = progress;
        guidedStateRef.current.onGuidedProgress(progress);
      }, 2000);
    }
  }, [activeEdit]);

  const updateSkipButtonPosition = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      setShowSkipButton(false);
      return;
    }

    const model = editor.getModel();
    if (!model || !isGuided || !activeEdit) {
      setShowSkipButton(false);
      return;
    }

    const ghostPosition = model.getPositionAt(editAnchor.length + localProgressRef.current);
    const lineNum = ghostPosition.lineNumber;

    const remainingLength = activeEdit.content.length - localProgressRef.current;
    if (remainingLength <= 0) {
      setShowSkipButton(false);
      return;
    }

    const currentCursor = editor.getPosition();
    if (!currentCursor || currentCursor.lineNumber !== lineNum) {
      setShowSkipButton(false);
      return;
    }

    const topInModel = editor.getTopForLineNumber(lineNum);
    const scrollTop = editor.getScrollTop();
    const viewportTop = topInModel - scrollTop;

    setButtonTop(viewportTop + 1);
    setShowSkipButton(true);
  }, [activeEdit, editAnchor.length, isGuided]);

  const updateEditorState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (!isGuided || !activeEdit) {
      ghostDecorationsRef.current?.clear();
      setShowSkipButton(false);
      return;
    }

    const ghostStart = model.getPositionAt(editAnchor.length + localProgressRef.current);

    editor.setPosition(ghostStart);
    if (lastRevealedLineRef.current !== ghostStart.lineNumber) {
      editor.revealPosition(ghostStart);
      lastRevealedLineRef.current = ghostStart.lineNumber;
    }

    const remainingLength = activeEdit.content.length - localProgressRef.current;
    if (remainingLength > 0) {
      const endLineNumber = Math.min(model.getLineCount(), ghostStart.lineNumber + 150);
      const endColumn = model.getLineMaxColumn(endLineNumber);

      ghostDecorationsRef.current?.set([
        {
          range: new monaco.Range(
            ghostStart.lineNumber,
            ghostStart.column,
            endLineNumber,
            endColumn
          ),
          options: {
            inlineClassName: "construct-monaco-ghost-text",
            stickiness:
              monaco.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges
          }
        }
      ]);
    } else {
      ghostDecorationsRef.current?.clear();
    }

    updateSkipButtonPosition();
  }, [activeEdit, editAnchor.length, isGuided, updateSkipButtonPosition]);

  const handleSkipLine = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !activeEdit) return;

    const model = editor.getModel();
    if (!model) return;

    const currentProgress = localProgressRef.current;
    if (currentProgress >= activeEdit.content.length) return;

    const nextNewlineIndex = activeEdit.content.indexOf("\n", currentProgress);
    const targetProgress = nextNewlineIndex !== -1 ? nextNewlineIndex + 1 : activeEdit.content.length;

    localProgressRef.current = targetProgress;
    guidedStateRef.current.onRevealLine();
    updateEditorState();
    updateProgress(targetProgress);

    editor.focus();
  }, [activeEdit, updateEditorState, updateProgress]);

  useEffect(() => {
    guidedStateRef.current = {
      activeEdit,
      editProgress,
      onFreeEdit,
      onGuidedProgress,
      onRevealLine
    };
  }, [activeEdit, editProgress, onFreeEdit, onGuidedProgress, onRevealLine]);

  // A single editor instance switches Monaco models as documents change.
  // Reset document-local state without disposing the editor service container.
  useEffect(() => {
    ghostDecorationsRef.current?.clear();
    focusDecorationsRef.current?.clear();
    localProgressRef.current = editProgress;
    lastSentProgressRef.current = editProgress;
  }, [path, activeEdit?.id]);

  // Synchronize internal typing progress with prop updates
  useEffect(() => {
    // If the prop matches the last progress we sent, it is just an echo of our own typing.
    // We don't want to reset local progress and jump the caret back!
    if (editProgress === lastSentProgressRef.current) {
      return;
    }

    localProgressRef.current = editProgress;
    lastSentProgressRef.current = editProgress;
    lastRevealedLineRef.current = null;
    updateEditorState();
  }, [editProgress, updateEditorState]);

  const absolutePath = useMemo(() => {
    if (!path) return "";
    if (path.startsWith("/") || path.includes(":\\") || path.includes(":/")) {
      return path;
    }
    return `${workspacePath}/${path}`;
  }, [path, workspacePath]);

  const isOutsideWorkspace = useMemo(() => {
    if (!absolutePath || !workspacePath) return false;
    const normPath = absolutePath.replace(/\\/g, "/");
    const normWs = workspacePath.replace(/\\/g, "/");
    const isUnderWorkspace = normPath.startsWith(normWs);
    const isNodeModules = normPath.includes("/node_modules/");
    return !isUnderWorkspace || isNodeModules;
  }, [absolutePath, workspacePath]);

  // Update editor options and trigger decoration updates when guided status changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.updateOptions({
      readOnly: isGuided || isOutsideWorkspace,
      readOnlyMessage: isGuided
        ? { value: "Type the highlighted implementation to advance." }
        : { value: "This file is outside the workspace and is read-only." }
    });

    if (!isGuided || !activeEdit) {
      ghostDecorationsRef.current?.clear();
    } else {
      updateEditorState();
    }
  }, [isGuided, isOutsideWorkspace, activeEdit?.id, updateEditorState]);

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      for (const disposable of editorDisposablesRef.current.splice(0)) {
        disposable.dispose();
      }
      restoreCodeEditorServiceRef.current?.();
      restoreCodeEditorServiceRef.current = null;
      ghostDecorationsRef.current?.clear();
      focusDecorationsRef.current?.clear();
      disposeCodeGhost();
    };
  }, []);

  // Handle pending jumps from Go to Definition
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && pendingJump) {
      const position = { lineNumber: pendingJump.line, column: pendingJump.column };
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
      onJumpComplete?.();
    }
  }, [pendingJump, onJumpComplete]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !focusRange) {
      focusDecorationsRef.current?.clear();
      return;
    }

    const model = editor.getModel();
    if (!model) {
      return;
    }

    const line = clamp(focusRange.line, 1, model.getLineCount());
    const endLine = clamp(focusRange.endLine ?? line, line, model.getLineCount());
    const column = focusRange.column ?? 1;
    const position = { lineNumber: line, column };
    editor.setPosition(position);
    editor.revealLineInCenter(line);
    focusDecorationsRef.current?.set([
      {
        range: new monaco.Range(
          line,
          1,
          endLine,
          model.getLineMaxColumn(endLine)
        ),
        options: {
          isWholeLine: true,
          hoverMessage: focusRange.hint ? { value: focusRange.hint } : undefined,
          blockClassName: "construct-monaco-focus-block",
          blockDoesNotCollapse: true,
          blockPadding: [6, 0, 6, 0]
        } as MonacoEditor.IModelDecorationOptions
      }
    ]);
  }, [focusRange]);

  if (!path) {
    return (
      <section className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        <p>Select a project file.</p>
      </section>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<section className="relative h-full min-h-0 overflow-hidden bg-background" data-guided={isGuided ? "true" : "false"} data-wrong={wrongInput ? "true" : "false"} />}>
          <Editor
            path={absolutePath}
            className="h-full"
            height="100%"
            language={language}
            options={{
              automaticLayout: true,
              contextmenu: false,
              scrollbar: { useShadows: false },
              cursorBlinking: "smooth",
              cursorStyle: "line",
              cursorWidth: 2,
              cursorSmoothCaretAnimation: "on",
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontLigatures: true,
              fontSize: 13.5,
              fixedOverflowWidgets: false,
              letterSpacing: 0.2,
              lineHeight: 22,
              minimap: { enabled: false },
              padding: { top: 16, bottom: 16 },
              renderLineHighlight: "all",
              renderWhitespace: "selection",
              roundedSelection: true,
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              tabSize: 2,
              wordBasedSuggestions: "off",
              wordWrap: "on"
            }}
        theme={editorTheme}
        value={displayContent}
        onChange={(value) => {
          if (!isGuided) {
            onFreeEdit(value ?? "");
          }
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          ghostDecorationsRef.current = editor.createDecorationsCollection();
          focusDecorationsRef.current = editor.createDecorationsCollection();
          initializeCodeGhost(editor);

          editor.updateOptions({
            readOnly: isGuided || isOutsideWorkspace,
            readOnlyMessage: isGuided
              ? { value: "Type the highlighted implementation to advance." }
              : { value: "This file is outside the workspace and is read-only." }
          });

          // Override Monaco's CodeEditorService to handle definition/reference navigation
          const codeEditorService = (editor as any)._codeEditorService;
          if (codeEditorService) {
            const originalOpenCodeEditor = codeEditorService.openCodeEditor.bind(codeEditorService);
            const openCodeEditor = async (input: any, source: any, sideBySide: any) => {
              const targetUri = input.resource;
              if (targetUri && targetUri.scheme === "file") {
                const targetPath = targetUri.fsPath || targetUri.path;
                const selection = input.options?.selection;
                const line = selection ? selection.startLineNumber : 1;
                const column = selection ? selection.startColumn : 1;

                if (openFileAndJumpRef.current) {
                  const relPath = lspClient.getRelativePath(targetPath);
                  openFileAndJumpRef.current(relPath, line, column);
                  return editor;
                }
              }
              return originalOpenCodeEditor(input, source, sideBySide);
            };
            codeEditorService.openCodeEditor = openCodeEditor;
            restoreCodeEditorServiceRef.current = () => {
              if (codeEditorService.openCodeEditor === openCodeEditor) {
                codeEditorService.openCodeEditor = originalOpenCodeEditor;
              }
            };
          }

          editorDisposablesRef.current.push(editor.onKeyDown((event) => {
            const current = guidedStateRef.current;
            if (!current.activeEdit) {
              // Even outside active edit, support Meta+S save logic
              if ((event.metaKey || event.ctrlKey) && event.keyCode === monaco.KeyCode.KeyS) {
                event.preventDefault();
                event.stopPropagation();
                const model = editor.getModel();
                if (model) {
                  lspClient.notifySaveModel(model);
                }
                saveRef.current?.();
              }
              return;
            }

            // Keyboard shortcuts to skip current line:
            // Ctrl + \ or Alt + Enter
            const isCtrlBackslash = event.keyCode === monaco.KeyCode.Backslash && (event.ctrlKey || event.metaKey);
            const isAltEnter = event.keyCode === monaco.KeyCode.Enter && event.altKey;

            if (isGuided && (isCtrlBackslash || isAltEnter)) {
              const model = editor.getModel();
              const cursor = editor.getPosition();
              if (model && cursor) {
                const ghostPosition = model.getPositionAt(editAnchor.length + localProgressRef.current);
                if (cursor.lineNumber === ghostPosition.lineNumber) {
                  event.preventDefault();
                  event.stopPropagation();
                  handleSkipLine();
                  return;
                }
              }
            }

            if ((event.metaKey || event.ctrlKey) && event.keyCode === monaco.KeyCode.KeyS) {
              event.preventDefault();
              event.stopPropagation();
              const model = editor.getModel();
              if (model) {
                lspClient.notifySaveModel(model);
              }
              saveRef.current?.();
              return;
            }

            if (event.metaKey || event.ctrlKey || event.altKey) {
              return;
            }

            if (event.keyCode === monaco.KeyCode.Backspace) {
              event.preventDefault();
              const newProgress = Math.max(0, localProgressRef.current - 1);
              localProgressRef.current = newProgress;
              updateEditorState();
              updateProgress(newProgress);
              return;
            }

            const input = normalizeMonacoKey(event);
            if (input === null) {
              return;
            }

            event.preventDefault();

            if (current.activeEdit.content.slice(localProgressRef.current, localProgressRef.current + input.length) === input) {
              const newProgress = localProgressRef.current + input.length;
              localProgressRef.current = newProgress;
              updateEditorState();
              updateProgress(newProgress);
              return;
            }

            setWrongInput(true);
            window.setTimeout(() => setWrongInput(false), 170);
          }));

          editorDisposablesRef.current.push(editor.onDidScrollChange(() => {
            updateSkipButtonPosition();
          }));

          editorDisposablesRef.current.push(editor.onDidChangeCursorPosition(() => {
            updateSkipButtonPosition();
          }));

          editorDisposablesRef.current.push(editor.onMouseUp(() => {
            const model = editor.getModel();
            const selection = editor.getSelection();
            if (!model || !selection || selection.isEmpty()) return;

            const text = normalizeSelectionText(model.getValueInRange(selection));
            const visiblePosition = editor.getScrolledVisiblePosition(selection.getEndPosition());
            const editorBounds = editor.getDomNode()?.getBoundingClientRect();
            if (!text || !visiblePosition || !editorBounds) return;

            emitConstructSelectionContext({
              text,
              source: "editor",
              sourceLabel: pathRef.current ?? "Editor",
              contextText: excerptLines(model.getValue(), selection.startLineNumber, selection.endLineNumber),
              anchor: {
                x: editorBounds.left + visiblePosition.left,
                y: editorBounds.top + visiblePosition.top + visiblePosition.height
              },
              filePath: pathRef.current ?? undefined,
              language,
              lineStart: selection.startLineNumber,
              lineEnd: selection.endLineNumber
            });
          }));

          localProgressRef.current = editProgress;
          lastRevealedLineRef.current = null;
          updateEditorState();

        }}
      />
      {buttonTop !== null && (
        <button
          className={`z-20 flex h-7 items-center gap-2 rounded-full border bg-background/80 px-2 text-xs shadow-sm transition-opacity hover:bg-muted ${showSkipButton ? "opacity-100" : "pointer-events-none opacity-0"}`}
          style={{
            position: "absolute",
            top: buttonTop,
            right: 28,
            zIndex: 100,
          }}
          onClick={handleSkipLine}
          title={os === "mac" ? "Skip Line (Option+Enter / Ctrl+\\)" : "Skip Line (Alt+Enter / Ctrl+\\)"}
          type="button"
        >
          <span>Skip Line</span>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground [&_kbd]:rounded [&_kbd]:border [&_kbd]:bg-muted [&_kbd]:px-1">
            {os === "mac" ? (
              <>
                <kbd>⌥</kbd>
                <kbd>⏎</kbd>
              </>
            ) : (
              <>
                <kbd>Alt</kbd>
                <kbd>Enter</kbd>
              </>
            )}
          </div>
        </button>
      )}
      {isGuided && activeEdit && (
        <div className="absolute bottom-3 right-3 z-10 flex min-w-48 items-center gap-3 rounded-[8px] border bg-popover/95 p-3 text-popover-foreground shadow-md backdrop-blur">
          <div className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">Code step</span>
            <strong className="block text-xs font-medium">{Math.min(totalLines, typedLines)} / {totalLines} lines</strong>
          </div>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <b className="text-xs font-medium">{percent}%</b>
        </div>
      )}
      </ContextMenuTrigger>

      <ContextMenuContent className="min-w-52">
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowSquareOut size={14} weight="duotone" />
            <span>Go to...</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onClick={() => triggerAction("editor.action.revealDefinition")}
              onSelect={() => triggerAction("editor.action.revealDefinition")}
            >
              <ArrowSquareOut size={14} weight="duotone" />
              <span>Go to Definition</span>
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>F12</kbd>
            </ContextMenuItem>
            
            <ContextMenuItem
              onClick={() => triggerAction("editor.action.peekDefinition")}
              onSelect={() => triggerAction("editor.action.peekDefinition")}
            >
              <Eye size={14} weight="duotone" />
              <span>Peek Definition</span>
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>⌥F12</kbd>
            </ContextMenuItem>
            
            <ContextMenuItem
              onClick={() => triggerAction("editor.action.referenceSearch.trigger")}
              onSelect={() => triggerAction("editor.action.referenceSearch.trigger")}
            >
              <MagnifyingGlass size={14} weight="duotone" />
              <span>Find All References</span>
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>⇧F12</kbd>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={isGuided}
          onClick={() => triggerAction("editor.action.rename")}
          onSelect={() => triggerAction("editor.action.rename")}
        >
          <PencilSimpleLine size={14} weight="duotone" />
          <span>Rename Symbol</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>F2</kbd>
        </ContextMenuItem>

        <ContextMenuItem
          disabled={isGuided}
          onClick={() => triggerAction("editor.action.changeAll")}
          onSelect={() => triggerAction("editor.action.changeAll")}
        >
          <Stack size={14} weight="duotone" />
          <span>Change All Occurrences</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>⌘F2</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={isGuided}
          onClick={() => triggerAction("editor.action.formatDocument")}
          onSelect={() => triggerAction("editor.action.formatDocument")}
        >
          <TextAlignLeft size={14} weight="duotone" />
          <span>Format Document</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>⌥⇧F</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => triggerAction("editor.action.quickCommand")}
          onSelect={() => triggerAction("editor.action.quickCommand")}
        >
          <Terminal size={14} weight="duotone" />
          <span>Command Palette</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--opaline-text-tertiary)", fontFamily: "inherit" }}>F1</kbd>
        </ContextMenuItem>
      </ContextMenuContent>


    </ContextMenu>
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}



function languageForPath(path: string | null) {
  if (!path) {
    return "plaintext";
  }

  const filename = path.split("/").pop() || "";
  const lowercaseFilename = filename.toLowerCase();

  // Exact filename matches
  if (lowercaseFilename === "dockerfile") return "dockerfile";
  if (lowercaseFilename === "gemfile") return "ruby";
  if (lowercaseFilename === "makefile") return "makefile";
  if (lowercaseFilename === "jenkinsfile") return "groovy";

  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) {
    return "plaintext";
  }

  const extensionMap: Record<string, string> = {
    // Web / Layout
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",

    // Config / Data / Markup
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    svg: "xml",
    toml: "toml",
    ini: "ini",
    conf: "ini",
    md: "markdown",
    mdx: "markdown",
    markdown: "markdown",
    graphql: "graphql",
    gql: "graphql",

    // System Languages
    rs: "rust",
    go: "go",
    c: "c",
    h: "cpp",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    swift: "swift",
    scala: "scala",
    sc: "scala",

    // Scripting / Shell / DB
    py: "python",
    pyi: "python",
    pyw: "python",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    ps1: "powershell",
    sql: "sql",
    vue: "html",
    svelte: "html",
    pl: "perl",
    pm: "perl",
    lua: "lua",
    r: "r",
    dart: "dart",
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    hrl: "erlang",
    zig: "zig",
    sol: "sol",
    clj: "clojure",
    cljs: "clojure",
    hs: "haskell",
    wat: "wast",
    wast: "wast"
  };

  return extensionMap[ext] || "plaintext";
}
