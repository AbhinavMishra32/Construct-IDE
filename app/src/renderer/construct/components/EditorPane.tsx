import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import { monaco } from "../../monaco";
import { lspClient } from "../lib/lspClient";
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
} from "@/components/open-shell";
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
  fileList = [],
  theme,
  pendingJump = null,
  focusRange = null,
  onJumpComplete,
  onOpenFileAndJump,
  readFileContent
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
  fileList?: string[];
  theme: "light" | "dark" | "system";
  pendingJump?: { line: number; column: number } | null;
  focusRange?: { line: number; endLine?: number; column?: number } | null;
  onJumpComplete?: () => void;
  onOpenFileAndJump?: (path: string, line: number, column: number) => void;
  readFileContent?: (path: string) => Promise<string>;
}) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const ghostDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
  const focusDecorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null);
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

  // Clean up stale editor refs when files/edits change
  useEffect(() => {
    editorRef.current = null;
    ghostDecorationsRef.current = null;
    focusDecorationsRef.current = null;
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
        ? { value: "Type the highlighted ghost text manually to advance." }
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
          blockClassName: "construct-monaco-focus-block",
          blockDoesNotCollapse: true,
          blockPadding: [3, 0, 3, 0],
          linesDecorationsClassName: "construct-monaco-focus-glyph"
        } as MonacoEditor.IModelDecorationOptions
      }
    ]);
  }, [focusRange]);

  // Register Monaco Definition Provider for Go to Definition (LSP)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const languages = [
      "python", "css", "html",
      "rust", "go", "cpp", "c", "csharp", "java", "kotlin", "swift",
      "ruby", "php", "shell", "sql", "lua"
    ];

    const disposables = languages.map((lang) =>
      monaco.languages.registerDefinitionProvider(lang, {
        async provideDefinition(model, position, token) {
          const lineText = model.getLineContent(position.lineNumber);
          const wordInfo = model.getWordAtPosition(position);
          if (!wordInfo) return null;

          const word = wordInfo.word;
          const currentContent = model.getValue();
          const currentFilePath = path || "";

          // 1. Check if defined locally in the current file
          const localDef = findSymbolDefinition(currentContent, word);
          if (localDef && localDef.line !== position.lineNumber) {
            if (hasRealLocalDefinition(currentContent, word)) {
              return {
                uri: model.uri,
                range: new monaco.Range(
                  localDef.line,
                  localDef.column,
                  localDef.line,
                  localDef.column + word.length
                )
              };
            }
          }

          // 2. Check if it's a cross-file workspace definition or quoted import path
          const importPath = findImportPathForSymbol(currentContent, word);
          if (importPath) {
            const resolved = resolvePath(currentFilePath, importPath);
            const target = findFileInWorkspace(resolved, fileList);
            if (target) {
              return {
                uri: model.uri,
                range: new monaco.Range(
                  position.lineNumber,
                  wordInfo.startColumn,
                  position.lineNumber,
                  wordInfo.endColumn
                )
              };
            }
          }

          const quoteMatches = [...lineText.matchAll(/(?:import|from|require|@import)\s+['"`]([^'"`]+)['"`]/g)];
          for (const match of quoteMatches) {
            const pathContent = match[1];
            const resolved = resolvePath(currentFilePath, pathContent);
            const target = findFileInWorkspace(resolved, fileList);
            if (target) {
              const pathContentStart = lineText.indexOf(pathContent);
              return {
                uri: model.uri,
                range: new monaco.Range(
                  position.lineNumber,
                  pathContentStart + 1,
                  position.lineNumber,
                  pathContentStart + pathContent.length + 1
                )
              };
            }
          }



          return null;
        }
      })
    );

    return () => {
      disposables.forEach((d) => d.dispose());
    };
  }, [path, fileList, onOpenFileAndJump, readFileContent, language]);

  if (!path) {
    return (
      <section className="editor-pane editor-pane--empty">
        <p>Select a project file.</p>
      </section>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <section className="editor-pane" data-guided={isGuided ? "true" : "false"} data-wrong={wrongInput ? "true" : "false"}>
          <Editor
            key={`${absolutePath}:${activeEdit?.id ?? "free"}:${editAnchor.length}`}
            path={absolutePath}
            className="editor-pane__monaco"
            height="100%"
            language={language}
            options={{
              automaticLayout: true,
              contextmenu: false,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              fontFamily:
                '"Geist Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontLigatures: true,
              fontSize: 13.5,
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

          editor.updateOptions({
            readOnly: isGuided || isOutsideWorkspace,
            readOnlyMessage: isGuided
              ? { value: "Type the highlighted ghost text manually to advance." }
              : { value: "This file is outside the workspace and is read-only." }
          });

          // Override Monaco's CodeEditorService to handle definition/reference navigation
          const codeEditorService = (editor as any)._codeEditorService;
          if (codeEditorService) {
            const originalOpenCodeEditor = codeEditorService.openCodeEditor.bind(codeEditorService);
            codeEditorService.openCodeEditor = async (input: any, source: any, sideBySide: any) => {
              const targetUri = input.resource;
              if (targetUri && targetUri.scheme === "file") {
                const targetPath = targetUri.fsPath || targetUri.path;
                const selection = input.options?.selection;
                const line = selection ? selection.startLineNumber : 1;
                const column = selection ? selection.startColumn : 1;

                if (onOpenFileAndJump) {
                  const relPath = lspClient.getRelativePath(targetPath);
                  onOpenFileAndJump(relPath, line, column);
                  return editor;
                }
              }
              return originalOpenCodeEditor(input, source, sideBySide);
            };
          }

          editor.onKeyDown((event) => {
            const current = guidedStateRef.current;
            if (!current.activeEdit || current.activeEdit.path !== path) {
              // Even outside active edit, support Meta+S save logic
              if ((event.metaKey || event.ctrlKey) && event.keyCode === monaco.KeyCode.KeyS) {
                event.preventDefault();
                event.stopPropagation();
                const model = editor.getModel();
                if (model) {
                  lspClient.notifySaveModel(model);
                }
                onSave?.();
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
              onSave?.();
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
          });

          editor.onDidScrollChange(() => {
            updateSkipButtonPosition();
          });

          editor.onDidChangeCursorPosition(() => {
            updateSkipButtonPosition();
          });

          localProgressRef.current = editProgress;
          lastRevealedLineRef.current = null;
          updateEditorState();

          editor.focus();
        }}
      />
      {buttonTop !== null && (
        <button
          className={`construct-editor-skip-button ${showSkipButton ? "is-visible" : ""}`}
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
          <div className="construct-editor-skip-shortcut">
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
        <div className="construct-editor-ghost-badge">
          <span>Ghost Progress: {Math.min(totalLines, typedLines)} / {totalLines} lines ({percent}%)</span>
        </div>
      )}
        </section>
      </ContextMenuTrigger>

      <ContextMenuContent className="construct-editor-context-menu">
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
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>F12</kbd>
            </ContextMenuItem>
            
            <ContextMenuItem
              onClick={() => triggerAction("editor.action.peekDefinition")}
              onSelect={() => triggerAction("editor.action.peekDefinition")}
            >
              <Eye size={14} weight="duotone" />
              <span>Peek Definition</span>
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>⌥F12</kbd>
            </ContextMenuItem>
            
            <ContextMenuItem
              onClick={() => triggerAction("editor.action.referenceSearch.trigger")}
              onSelect={() => triggerAction("editor.action.referenceSearch.trigger")}
            >
              <MagnifyingGlass size={14} weight="duotone" />
              <span>Find All References</span>
              <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>⇧F12</kbd>
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
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>F2</kbd>
        </ContextMenuItem>

        <ContextMenuItem
          disabled={isGuided}
          onClick={() => triggerAction("editor.action.changeAll")}
          onSelect={() => triggerAction("editor.action.changeAll")}
        >
          <Stack size={14} weight="duotone" />
          <span>Change All Occurrences</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>⌘F2</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={isGuided}
          onClick={() => triggerAction("editor.action.formatDocument")}
          onSelect={() => triggerAction("editor.action.formatDocument")}
        >
          <TextAlignLeft size={14} weight="duotone" />
          <span>Format Document</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>⌥⇧F</kbd>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() => triggerAction("editor.action.quickCommand")}
          onSelect={() => triggerAction("editor.action.quickCommand")}
        >
          <Terminal size={14} weight="duotone" />
          <span>Command Palette</span>
          <kbd style={{ marginLeft: "auto", fontSize: "11px", color: "var(--codex-text-tertiary)", fontFamily: "inherit" }}>F1</kbd>
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
    pyw: "python",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    ps1: "powershell",
    sql: "sql",
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

function resolvePath(currentPath: string, importPath: string): string {
  if (importPath.startsWith("@/")) {
    return "app/src/renderer/" + importPath.slice(2);
  }

  const parts = currentPath.split("/");
  parts.pop(); // remove filename

  const importParts = importPath.split("/");
  for (const part of importParts) {
    if (part === ".") {
      continue;
    } else if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

function findFileInWorkspace(resolvedPath: string, fileList: string[]): string | null {
  if (fileList.includes(resolvedPath)) {
    return resolvedPath;
  }

  const extensions = [
    ".ts", ".tsx", ".js", ".jsx", ".css", ".json",
    ".py", ".pyw", ".ipy", ".rs", ".go", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp",
    ".swift", ".rb", ".kt", ".kts", ".java", ".sh", ".bash", ".zsh"
  ];
  for (const ext of extensions) {
    const pathWithExt = resolvedPath + ext;
    if (fileList.includes(pathWithExt)) {
      return pathWithExt;
    }
  }

  for (const ext of extensions) {
    const pathWithIndex = `${resolvedPath}/index${ext}`;
    if (fileList.includes(pathWithIndex)) {
      return pathWithIndex;
    }
  }

  return null;
}

function findSymbolDefinition(content: string, word: string): { line: number, column: number } | null {
  const lines = content.split("\n");
  const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  const regexes = [
    new RegExp(`\\b(function|class|interface|type|enum)\\s+${escapedWord}\\b`),
    new RegExp(`\\b(const|let|var)\\s+${escapedWord}\\s*=`),
    new RegExp(`\\b(def|class)\\s+${escapedWord}\\b`),
    new RegExp(`\\b${escapedWord}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`\\b${escapedWord}\\s*:\\s*\\([^)]*\\)\\s*=>`)
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const regex of regexes) {
      const match = line.match(regex);
      if (match) {
        const col = line.indexOf(word);
        return { line: i + 1, column: col !== -1 ? col + 1 : 1 };
      }
    }
  }

  const fallbackRegex = new RegExp(`\\b${escapedWord}\\b`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fallbackRegex.test(line)) {
      const col = line.indexOf(word);
      return { line: i + 1, column: col !== -1 ? col + 1 : 1 };
    }
  }

  return null;
}

function findImportPathForSymbol(currentContent: string, symbol: string): string | null {
  const lines = currentContent.split("\n");
  const escapedSymbol = symbol.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  for (const line of lines) {
    if (!line.includes("import") && !line.includes("require")) {
      continue;
    }

    const symbolRegex = new RegExp(`\\b${escapedSymbol}\\b`);
    if (!symbolRegex.test(line)) {
      continue;
    }

    const pathMatch = line.match(/['"`]([^'"`]+)['"`]/);
    if (pathMatch) {
      return pathMatch[1];
    }
  }

  return null;
}

function getExternalModuleDocsUrl(moduleName: string, language: string): string | null {
  const cleanModule = moduleName.trim().replace(/^['"`]|['"`]$/g, "");
  const lower = cleanModule.toLowerCase();

  if (language === "swift") {
    const swiftFrameworks = [
      "foundation", "uikit", "swiftui", "appkit", "combine", "dispatch",
      "coredata", "coregraphics", "coreanimation", "quartzcore", "metal",
      "metalkit", "avfoundation", "avkit", "webkit", "spritekit", "scenekit",
      "mapkit", "contacts", "eventkit", "safariservices", "localauthentication",
      "security", "cryptokit", "compression", "network", "os", "metrickit",
      "corelocation", "corebluetooth", "coremotion", "audiotoolbox", "mediaplayer"
    ];
    if (swiftFrameworks.includes(lower)) {
      return `https://developer.apple.com/documentation/${lower}`;
    }
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(cleanModule)) {
      return `https://developer.apple.com/documentation/${lower}`;
    }
  }

  if (language === "python" || language === "py") {
    const pythonStdLibs = [
      "os", "sys", "math", "json", "re", "datetime", "time", "random", "collections",
      "itertools", "functools", "pathlib", "shutil", "glob", "fnmatch", "pickle",
      "sqlite3", "csv", "zlib", "gzip", "tarfile", "zipfile", "socket", "ssl",
      "select", "selectors", "asyncio", "threading", "multiprocessing", "subprocess",
      "queue", "urllib", "http", "ftplib", "smtplib", "email", "xml", "hashlib",
      "hmac", "secrets", "uuid", "argparse", "logging", "unittest", "mock",
      "tempfile", "io", "copy", "traceback", "linecache", "ast", "symtable", "string"
    ];
    if (pythonStdLibs.includes(lower)) {
      return `https://docs.python.org/3/library/${lower}.html`;
    }
    return `https://pypi.org/project/${cleanModule}/`;
  }

  if (language === "javascript" || language === "typescript" || language === "js" || language === "ts" || language === "tsx" || language === "jsx") {
    const nodeStdLibs = [
      "fs", "path", "os", "http", "https", "crypto", "child_process", "dns", "events",
      "readline", "stream", "util", "url", "zlib", "buffer", "net", "tls", "dgram",
      "querystring", "string_decoder", "timers", "v8", "vm", "worker_threads"
    ];
    let moduleWithoutNodePrefix = cleanModule;
    if (cleanModule.startsWith("node:")) {
      moduleWithoutNodePrefix = cleanModule.slice(5);
    }
    const cleanLower = moduleWithoutNodePrefix.toLowerCase();
    if (nodeStdLibs.includes(cleanLower)) {
      return `https://nodejs.org/api/${cleanLower}.html`;
    }
    if (!cleanModule.startsWith(".") && !cleanModule.startsWith("/")) {
      return `https://www.npmjs.com/package/${cleanModule}`;
    }
  }

  if (language === "go") {
    return `https://pkg.go.dev/${cleanModule}`;
  }

  if (language === "rust" || language === "rs") {
    if (cleanModule.startsWith("std::") || cleanModule === "std") {
      let sub = cleanModule;
      if (cleanModule.startsWith("std::")) {
        sub = cleanModule.slice(5);
      }
      const parts = sub.split("::");
      if (parts.length > 1) {
        const modulePath = parts.slice(0, -1).join("/");
        const typeName = parts[parts.length - 1];
        if (typeName[0] === typeName[0].toUpperCase()) {
          return `https://doc.rust-lang.org/std/${modulePath}/struct.${typeName}.html`;
        } else {
          return `https://doc.rust-lang.org/std/${modulePath}/${typeName}/index.html`;
        }
      }
      return `https://doc.rust-lang.org/std/${sub}/index.html`;
    }
    return `https://crates.io/crates/${cleanModule}`;
  }

  return null;
}

function getExternalSymbolSearchUrl(word: string, language: string): string | null {
  if (!/^[a-zA-Z0-9_]+$/.test(word)) {
    return null;
  }
  if (word.length < 3) {
    return null;
  }

  if (language === "swift") {
    return `https://developer.apple.com/search/?q=${word}`;
  }
  if (language === "python" || language === "py") {
    return `https://docs.python.org/3/search.html?q=${word}`;
  }
  if (language === "javascript" || language === "typescript" || language === "js" || language === "ts" || language === "tsx" || language === "jsx") {
    if (/^[A-Z]/.test(word) || ["fetch", "window", "document", "console", "require"].includes(word)) {
      return `https://developer.mozilla.org/en-US/search?q=${word}`;
    }
    return `https://www.npmjs.com/search?q=${word}`;
  }
  if (language === "go") {
    return `https://pkg.go.dev/search?q=${word}`;
  }
  if (language === "rust" || language === "rs") {
    return `https://docs.rs/releases/search?query=${word}`;
  }
  return null;
}

function hasRealLocalDefinition(currentContent: string, word: string): boolean {
  const lines = currentContent.split("\n");
  const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const definitionRegexes = [
    new RegExp(`\\b(function|class|interface|type|enum)\\s+${escapedWord}\\b`),
    new RegExp(`\\b(const|let|var)\\s+${escapedWord}\\s*=`),
    new RegExp(`\\b(def|class)\\s+${escapedWord}\\b`),
    new RegExp(`\\b${escapedWord}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`\\b${escapedWord}\\s*:\\s*\\([^)]*\\)\\s*=>`)
  ];
  for (const line of lines) {
    for (const regex of definitionRegexes) {
      if (regex.test(line)) {
        return true;
      }
    }
  }
  return false;
}
