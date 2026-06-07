import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";

import { monaco } from "../../monaco";
import {
  CONSTRUCT_DARK,
  CONSTRUCT_LIGHT,
  registerConstructThemes
} from "../editorThemes";
import type { EditBlock } from "../types";

registerConstructThemes();

function useEditorTheme() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => setDark(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return dark ? CONSTRUCT_DARK : CONSTRUCT_LIGHT;
}

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
  onGuidedProgress,
  fileList = [],
  pendingJump = null,
  onJumpComplete,
  onOpenFileAndJump,
  readFileContent
}: {
  path: string | null;
  content: string;
  activeEdit: EditBlock | null;
  editAnchor: string;
  editProgress: number;
  onFreeEdit: (content: string) => void;
  onGuidedProgress: (progress: number) => void;
  fileList?: string[];
  pendingJump?: { line: number; column: number } | null;
  onJumpComplete?: () => void;
  onOpenFileAndJump?: (path: string, line: number, column: number) => void;
  readFileContent?: (path: string) => Promise<string>;
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
  const editorTheme = useEditorTheme();

  const localProgressRef = useRef(editProgress);
  const lastSentProgressRef = useRef(editProgress);
  const lastRevealedLineRef = useRef<number | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const typed = activeEdit?.content.slice(0, editProgress) ?? "";
  const remaining = activeEdit?.content.slice(editProgress) ?? "";
  const isGuided = Boolean(activeEdit && activeEdit.path === path);
  const displayContent = isGuided ? `${editAnchor}${typed}${remaining}` : content;
  const language = useMemo(() => languageForPath(path), [path]);

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

  const updateEditorState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (!isGuided || !activeEdit) {
      ghostDecorationsRef.current?.clear();
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
  }, [activeEdit, editAnchor.length, isGuided]);

  useEffect(() => {
    guidedStateRef.current = {
      activeEdit,
      editProgress,
      onFreeEdit,
      onGuidedProgress
    };
  }, [activeEdit, editProgress, onFreeEdit, onGuidedProgress]);

  // Clean up stale editor refs when files/edits change
  useEffect(() => {
    editorRef.current = null;
    ghostDecorationsRef.current = null;
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

  // Update editor options and trigger decoration updates when guided status changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.updateOptions({
      readOnly: isGuided,
      readOnlyMessage: { value: "Type the highlighted ghost text manually to advance." }
    });

    if (!isGuided || !activeEdit) {
      ghostDecorationsRef.current?.clear();
    } else {
      updateEditorState();
    }
  }, [isGuided, activeEdit?.id, updateEditorState]);

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

  // Register Monaco Definition Provider for Go to Definition (LSP)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const languages = [
      "typescript", "javascript", "python", "css", "html", "json",
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

          // 3. Check if it's an external library/framework/module import or external symbol
          const isExternal = isExternalSymbolOrImport(word, lineText, currentContent, language, currentFilePath, fileList);
          if (isExternal) {
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
    <section className="editor-pane" data-guided={isGuided ? "true" : "false"} data-wrong={wrongInput ? "true" : "false"}>
      <Editor
        key={`${path}:${activeEdit?.id ?? "free"}`}
        className="editor-pane__monaco"
        height="100%"
        language={language}
        options={{
          automaticLayout: true,
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

          editor.updateOptions({
            readOnly: isGuided,
            readOnlyMessage: { value: "Type the highlighted ghost text manually to advance." }
          });

          // Intercept Cmd+Click for cross-file definitions and external documentation links
          editor.onMouseUp((e) => {
            const isCmdClick = e.event.metaKey || e.event.ctrlKey;
            if (!isCmdClick) return;

            const position = e.target.position;
            if (!position) return;

            const model = editor.getModel();
            if (!model) return;

            const wordInfo = model.getWordAtPosition(position);
            if (!wordInfo) return;

            const word = wordInfo.word;
            const lineText = model.getLineContent(position.lineNumber);
            const currentContent = model.getValue();
            const currentFilePath = path || "";

            const importPath = findImportPathForSymbol(currentContent, word);
            if (importPath) {
              const resolved = resolvePath(currentFilePath, importPath);
              const target = findFileInWorkspace(resolved, fileList);
              if (target && onOpenFileAndJump && readFileContent) {
                void (async () => {
                  const targetContent = await readFileContent(target);
                  const targetDef = findSymbolDefinition(targetContent, word);
                  if (targetDef) {
                    onOpenFileAndJump(target, targetDef.line, targetDef.column);
                  }
                })();
                return;
              }
            }

            const quoteMatches = [...lineText.matchAll(/(?:import|from|require|@import)\s+['"`]([^'"`]+)['"`]/g)];
            for (const match of quoteMatches) {
              const pathContent = match[1];
              const resolved = resolvePath(currentFilePath, pathContent);
              const target = findFileInWorkspace(resolved, fileList);
              if (target && onOpenFileAndJump) {
                onOpenFileAndJump(target, 1, 1);
                return;
              }
            }

            const url = getDocsUrlForPosition(word, lineText, currentContent, language, currentFilePath, fileList);
            if (url) {
              window.open(url, "_blank");
            }
          });

          editor.onKeyDown((event) => {
            // Handle F12 Go to Definition keypress
            if (event.keyCode === monaco.KeyCode.F12) {
              const position = editor.getPosition();
              if (position) {
                const model = editor.getModel();
                if (model) {
                  const wordInfo = model.getWordAtPosition(position);
                  if (wordInfo) {
                    const word = wordInfo.word;
                    const lineText = model.getLineContent(position.lineNumber);
                    const currentContent = model.getValue();
                    const currentFilePath = path || "";

                    const importPath = findImportPathForSymbol(currentContent, word);
                    if (importPath) {
                      const resolved = resolvePath(currentFilePath, importPath);
                      const target = findFileInWorkspace(resolved, fileList);
                      if (target && onOpenFileAndJump && readFileContent) {
                        event.preventDefault();
                        event.stopPropagation();
                        void (async () => {
                          const targetContent = await readFileContent(target);
                          const targetDef = findSymbolDefinition(targetContent, word);
                          if (targetDef) {
                            onOpenFileAndJump(target, targetDef.line, targetDef.column);
                          }
                        })();
                        return;
                      }
                    }

                    const quoteMatches = [...lineText.matchAll(/(?:import|from|require|@import)\s+['"`]([^'"`]+)['"`]/g)];
                    for (const match of quoteMatches) {
                      const pathContent = match[1];
                      const resolved = resolvePath(currentFilePath, pathContent);
                      const target = findFileInWorkspace(resolved, fileList);
                      if (target && onOpenFileAndJump) {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenFileAndJump(target, 1, 1);
                        return;
                      }
                    }

                    const url = getDocsUrlForPosition(word, lineText, currentContent, language, currentFilePath, fileList);
                    if (url) {
                      event.preventDefault();
                      event.stopPropagation();
                      window.open(url, "_blank");
                    }
                  }
                }
              }
              return;
            }

            const current = guidedStateRef.current;
            if (!current.activeEdit || current.activeEdit.path !== path) {
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

          localProgressRef.current = editProgress;
          lastRevealedLineRef.current = null;
          updateEditorState();

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

function isExternalSymbolOrImport(
  word: string,
  lineText: string,
  currentContent: string,
  language: string,
  currentFilePath: string,
  fileList: string[]
): boolean {
  // 1. Quoted import path click
  const quoteMatches = [...lineText.matchAll(/(?:import|from|require|@import)\s+['"`]([^'"`]+)['"`]/g)];
  for (const match of quoteMatches) {
    const pathContent = match[1];
    const resolved = resolvePath(currentFilePath, pathContent);
    const target = findFileInWorkspace(resolved, fileList);
    if (!target) {
      if (getExternalModuleDocsUrl(pathContent, language)) return true;
    }
  }

  // 2. Unquoted import module name click
  if (language === "swift" || language === "python" || language === "py") {
    const importMatch = lineText.match(/^\s*import\s+([A-Za-z0-9_,\s]+)/);
    if (importMatch) {
      const modules = importMatch[1].split(",").map(m => m.trim());
      if (modules.includes(word)) {
        if (getExternalModuleDocsUrl(word, language)) return true;
      }
    }

    const fromImportMatch = lineText.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import/);
    if (fromImportMatch) {
      const moduleName = fromImportMatch[1];
      if (word === moduleName) {
        if (getExternalModuleDocsUrl(moduleName, language)) return true;
      }
      const importedSymbolsPart = lineText.split("import")[1] || "";
      const symbols = importedSymbolsPart.split(",").map(s => s.trim().split(/\s+/)[0]);
      if (symbols.includes(word)) {
        if (getExternalModuleDocsUrl(moduleName, language)) return true;
      }
    }
  }

  // 3. Checked if defined locally in this file
  if (hasRealLocalDefinition(currentContent, word)) {
    return false;
  }

  // 4. Imported from another file
  const importPath = findImportPathForSymbol(currentContent, word);
  if (importPath) {
    const resolved = resolvePath(currentFilePath, importPath);
    const target = findFileInWorkspace(resolved, fileList);
    if (target) {
      return false; // local file, not external
    }
    return true; // imported from an external package
  }

  // 5. Fallback search engine check
  if (getExternalSymbolSearchUrl(word, language)) {
    return true;
  }

  return false;
}

function getDocsUrlForPosition(
  word: string,
  lineText: string,
  currentContent: string,
  language: string,
  currentFilePath: string,
  fileList: string[]
): string | null {
  // 1. Quoted import path click
  const quoteMatches = [...lineText.matchAll(/(?:import|from|require|@import)\s+['"`]([^'"`]+)['"`]/g)];
  for (const match of quoteMatches) {
    const pathContent = match[1];
    const resolved = resolvePath(currentFilePath, pathContent);
    const target = findFileInWorkspace(resolved, fileList);
    if (!target) {
      const url = getExternalModuleDocsUrl(pathContent, language);
      if (url) return url;
    }
  }

  // 2. Unquoted import module name click
  if (language === "swift" || language === "python" || language === "py") {
    const importMatch = lineText.match(/^\s*import\s+([A-Za-z0-9_,\s]+)/);
    if (importMatch) {
      const modules = importMatch[1].split(",").map(m => m.trim());
      if (modules.includes(word)) {
        const url = getExternalModuleDocsUrl(word, language);
        if (url) return url;
      }
    }

    const fromImportMatch = lineText.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import/);
    if (fromImportMatch) {
      const moduleName = fromImportMatch[1];
      if (word === moduleName) {
        const url = getExternalModuleDocsUrl(moduleName, language);
        if (url) return url;
      }
      const importedSymbolsPart = lineText.split("import")[1] || "";
      const symbols = importedSymbolsPart.split(",").map(s => s.trim().split(/\s+/)[0]);
      if (symbols.includes(word)) {
        const url = getExternalModuleDocsUrl(moduleName, language);
        if (url) return url;
      }
    }
  }

  // 3. Checked if defined locally in this file
  if (hasRealLocalDefinition(currentContent, word)) {
    return null;
  }

  // 4. Imported from another file
  const importPath = findImportPathForSymbol(currentContent, word);
  if (importPath) {
    const resolved = resolvePath(currentFilePath, importPath);
    const target = findFileInWorkspace(resolved, fileList);
    if (target) {
      return null; // Local workspace file
    }
    const url = getExternalModuleDocsUrl(importPath, language);
    if (url) return url;
  }

  // 5. Fallback documentation search
  return getExternalSymbolSearchUrl(word, language);
}
