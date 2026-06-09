import { monaco } from "../../monaco";
import { logStore } from "./logStore";

type LspLanguage = "typescript" | "python";

class LspClientClass {
  private isInitialized = false;
  private disposables: monaco.IDisposable[] = [];
  private nextRequestId = 1;
  private activeWorkspacePath = "";
  private modelListeners = new Map<string, monaco.IDisposable[]>();
  private initializedLanguages = new Set<LspLanguage>();
  private workspaceFiles: string[] = [];

  async initialize(workspacePath: string, options: { force?: boolean; languages?: LspLanguage[] } = {}) {
    if (!options.force && this.isInitialized && this.activeWorkspacePath === workspacePath) {
      return;
    }

    this.dispose();
    this.activeWorkspacePath = workspacePath;
    this.isInitialized = true;

    console.log("[LSP Client] Initializing handshake for:", workspacePath);

    try {
      const languages = options.languages?.length ? options.languages : (["typescript"] as LspLanguage[]);
      for (const language of languages) {
        try {
          await this.initializeLanguage(language, workspacePath);
        } catch (err) {
          logStore.addLog("lsp-server", `[${language}] ${err instanceof Error ? err.message : String(err)}`, "warn");
        }
      }

      console.log("[LSP Client] Handshake completed successfully.");

      // 3. Disable Monaco's default TypeScript and JavaScript workers to avoid duplicate completions/diagnostics
      monaco.languages.typescript.typescriptDefaults.setModeConfiguration({
        completionItems: false,
        hovers: false,
        documentSymbols: false,
        definitions: false,
        references: false,
        signatureHelp: false,
        diagnostics: false
      });

      monaco.languages.typescript.javascriptDefaults.setModeConfiguration({
        completionItems: false,
        hovers: false,
        documentSymbols: false,
        definitions: false,
        references: false,
        signatureHelp: false,
        diagnostics: false
      });

      // 4. Register custom providers
      this.registerProviders();

      // 5. Setup diagnostics listeners
      this.setupDiagnostics();

      // 6. Watch model creation/disposal and watch current models
      this.disposables.push(
        monaco.editor.onDidCreateModel((model) => {
          this.watchModel(model);
        })
      );

      this.disposables.push(
        monaco.editor.onWillDisposeModel((model) => {
          this.unwatchModel(model);
        })
      );

      monaco.editor.getModels().forEach((model) => {
        this.watchModel(model);
      });

    } catch (err) {
      console.error("[LSP Client] Failed to initialize LSP:", err);
      this.isInitialized = false;
    }
  }

  private async initializeLanguage(language: LspLanguage, workspacePath: string) {
    await this.sendRequest("initialize", {
      processId: null,
      clientInfo: { name: "Construct-Monaco-LSP", version: "1.0.0" },
      rootPath: workspacePath,
      rootUri: "file://" + workspacePath,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: true,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true
          },
          completion: {
            dynamicRegistration: true,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              deprecatedSupport: true,
              preselectSupport: true
            },
            contextSupport: true
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ["markdown", "plaintext"]
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"]
            }
          },
          definition: {
            dynamicRegistration: true,
            linkSupport: true
          },
          typeDefinition: {
            dynamicRegistration: true,
            linkSupport: true
          },
          implementation: {
            dynamicRegistration: true,
            linkSupport: true
          },
          references: {
            dynamicRegistration: true
          },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] },
            versionSupport: true
          }
        },
        workspace: {
          configuration: true,
          workspaceFolders: true
        }
      },
      initializationOptions: language === "typescript"
        ? {
            preferences: {
              includePackageJsonAutoImports: "on",
              includeCompletionsForModuleExports: true
            }
          }
        : undefined,
      workspaceFolders: [{
        uri: "file://" + workspacePath,
        name: workspacePath.split("/").pop() || "workspace"
      }]
    }, language);

    this.sendNotification("initialized", {}, language);
    this.initializedLanguages.add(language);
    logStore.addLog("lsp-server", `[${language}] initialized`, "info");
  }

  // JSON-RPC requests
  async sendRequest(method: string, params: any, language: LspLanguage = "typescript"): Promise<any> {
    const id = this.nextRequestId++;
    const payload = { jsonrpc: "2.0", id, languageId: language, method, params };
    
    logStore.addLog("lsp-protocol", `--> ${language} Request: ${method} (id: ${id})\n${JSON.stringify(params, null, 2)}`, "info");
    
    try {
      const response: any = await window.constructProjects.lspRequest(payload);
      if (response && response.error) {
        logStore.addLog("lsp-protocol", `<-- Error Response: ${method} (id: ${id})\n${JSON.stringify(response.error, null, 2)}`, "error");
        throw new Error(response.error.message || JSON.stringify(response.error));
      }
      logStore.addLog("lsp-protocol", `<-- Response: ${method} (id: ${id})\n${JSON.stringify(response ? response.result : null, null, 2)}`, "info");
      return response ? response.result : null;
    } catch (err) {
      logStore.addLog("lsp-protocol", `[Request Failed] ${method} (id: ${id}): ${err instanceof Error ? err.message : String(err)}`, "error");
      throw err;
    }
  }

  // JSON-RPC notifications
  sendNotification(method: string, params: any, language: LspLanguage = "typescript") {
    const payload = { jsonrpc: "2.0", languageId: language, method, params };
    logStore.addLog("lsp-protocol", `--> ${language} Notification: ${method}\n${JSON.stringify(params, null, 2)}`, "info");
    
    window.constructProjects.lspRequest(payload).catch((err) => {
      console.error("[LSP Client] Notification error:", err);
      logStore.addLog("lsp-protocol", `[${language} Notification Error] ${method}: ${err instanceof Error ? err.message : String(err)}`, "error");
    });
  }

  private watchModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    this.unwatchModel(model);
    this.openModel(model);

    const listeners: monaco.IDisposable[] = [];

    // Notify of changes on edit
    listeners.push(
      model.onDidChangeContent(() => {
        this.changeModel(model);
      })
    );

    this.modelListeners.set(uri, listeners);
  }

  private unwatchModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    const listeners = this.modelListeners.get(uri);
    if (listeners) {
      listeners.forEach((l) => l.dispose());
      this.modelListeners.delete(uri);
    }
    this.closeModel(model);
  }

  private openModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    const language = languageForModel(model);
    if (!language || !this.initializedLanguages.has(language.server)) return;

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: language.languageId,
        version: model.getVersionId(),
        text: model.getValue()
      }
    }, language.server);
  }

  private changeModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    const language = languageForModel(model);
    if (!language || !this.initializedLanguages.has(language.server)) return;

    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri,
        version: model.getVersionId()
      },
      contentChanges: [{ text: model.getValue() }]
    }, language.server);
  }

  private closeModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    const language = languageForModel(model);
    if (!language || !this.initializedLanguages.has(language.server)) return;

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri }
    }, language.server);

    monaco.editor.setModelMarkers(model, "lsp", []);
  }

  notifySaveModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    const language = languageForModel(model);
    if (!language || !this.initializedLanguages.has(language.server)) return;

    this.sendNotification("textDocument/didSave", {
      textDocument: { uri }
    }, language.server);
  }

  private setupDiagnostics() {
    const cleanup = window.constructProjects.onLspNotification((notification: any) => {
      logStore.addLog("lsp-protocol", `<-- Notification: ${notification.method}\n${JSON.stringify(notification.params, null, 2)}`, "info");
      
      if (notification.method === "textDocument/publishDiagnostics") {
        const { uri, diagnostics } = notification.params;
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (!model) return;

        const markers = diagnostics.map((d: any) => {
          let severity = monaco.MarkerSeverity.Info;
          if (d.severity === 1) severity = monaco.MarkerSeverity.Error;
          else if (d.severity === 2) severity = monaco.MarkerSeverity.Warning;
          else if (d.severity === 3) severity = monaco.MarkerSeverity.Info;
          else if (d.severity === 4) severity = monaco.MarkerSeverity.Hint;

          return {
            severity,
            message: d.message,
            source: d.source || notification.languageId || "lsp",
            startLineNumber: d.range.start.line + 1,
            startColumn: d.range.start.character + 1,
            endLineNumber: d.range.end.line + 1,
            endColumn: d.range.end.character + 1
          };
        });

        monaco.editor.setModelMarkers(model, "lsp", markers);
      }
    });
    this.disposables.push({ dispose: cleanup });
  }

  private registerProviders() {
    const languages = ["typescript", "javascript", "json", "python"];

    languages.forEach((lang) => {
      // 1. Hover
      this.disposables.push(
        monaco.languages.registerHoverProvider(lang, {
          provideHover: async (model, position) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/hover", {
                textDocument: { uri },
                position: toLspPosition(position)
              }, language.server);
              if (!res) return null;
              return toMonacoHover(res);
            } catch (err) {
              console.error("[LSP Hover error]:", err);
              return null;
            }
          }
        })
      );

      // 2. Definition
      this.disposables.push(
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: async (model, position) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/definition", {
                textDocument: { uri },
                position: toLspPosition(position)
              }, language.server);
              if (!res) return null;

              return toMonacoLocations(res);
            } catch (err) {
              console.error("[LSP Definition error]:", err);
              return null;
            }
          }
        })
      );

      this.disposables.push(
        monaco.languages.registerTypeDefinitionProvider(lang, {
          provideTypeDefinition: async (model, position) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/typeDefinition", {
                textDocument: { uri },
                position: toLspPosition(position)
              }, language.server);
              return res ? toMonacoLocations(res) : null;
            } catch (err) {
              console.error("[LSP Type Definition error]:", err);
              return null;
            }
          }
        })
      );

      this.disposables.push(
        monaco.languages.registerImplementationProvider(lang, {
          provideImplementation: async (model, position) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/implementation", {
                textDocument: { uri },
                position: toLspPosition(position)
              }, language.server);
              return res ? toMonacoLocations(res) : null;
            } catch (err) {
              console.error("[LSP Implementation error]:", err);
              return null;
            }
          }
        })
      );

      // 3. References
      this.disposables.push(
        monaco.languages.registerReferenceProvider(lang, {
          provideReferences: async (model, position, context) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/references", {
                textDocument: { uri },
                position: toLspPosition(position),
                context: {
                  includeDeclaration: context.includeDeclaration
                }
              }, language.server);
              if (!res || !Array.isArray(res)) return null;
              return res.map(toMonacoLocation);
            } catch (err) {
              console.error("[LSP References error]:", err);
              return null;
            }
          }
        })
      );

      // 4. Completions
      this.disposables.push(
        monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: [".", "\"", "'", "/", "@", "<"],
          provideCompletionItems: async (model, position, context) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const language = languageForModel(model);
              if (!language || !this.initializedLanguages.has(language.server)) return null;
              const res = await this.sendRequest("textDocument/completion", {
                textDocument: { uri },
                position: toLspPosition(position),
                context: {
                  triggerKind: context.triggerKind,
                  triggerCharacter: context.triggerCharacter
                }
              }, language.server);
              if (!res) return null;

              const items = Array.isArray(res) ? res : res.items || [];
              const word = model.getWordUntilPosition(position);
              const defaultRange = new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                position.column
              );

              const mapped = items.map((item: any) =>
                toMonacoCompletionItem(item, defaultRange)
              );
              return {
                suggestions: mapped,
                incomplete: Array.isArray(res) ? false : !!res.isIncomplete
              };
            } catch (err) {
              console.error("[LSP Completions error]:", err);
              return null;
            }
          }
        })
      );
    });

    this.registerImportPathProvider();
  }

  setWorkspaceFiles(files: string[]) {
    this.workspaceFiles = [...new Set(files.map(normalizeWorkspacePath).filter(Boolean))];
  }

  private registerImportPathProvider() {
    const languages = ["typescript", "javascript"];
    languages.forEach((lang) => {
      this.disposables.push(
        monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: [".", "/", "\"", "'"],
          provideCompletionItems: (model, position) => {
            const request = getImportPathRequest(model, position, this.activeWorkspacePath);
            if (!request) {
              return { suggestions: [] };
            }

            const suggestions = buildImportPathSuggestions(this.workspaceFiles, request).map((item) => ({
              label: item.label,
              kind: item.isDirectory
                ? monaco.languages.CompletionItemKind.Folder
                : monaco.languages.CompletionItemKind.File,
              insertText: item.insertText,
              range: request.range,
              sortText: item.isDirectory ? `0_${item.label}` : `1_${item.label}`,
              command: item.isDirectory
                ? { id: "editor.action.triggerSuggest", title: "Suggest" }
                : undefined
            }));

            return { suggestions };
          }
        })
      );
    });
  }

  dispose() {
    this.isInitialized = false;
    this.activeWorkspacePath = "";
    this.initializedLanguages.clear();
    this.workspaceFiles = [];

    this.disposables.forEach((d) => {
      try {
        d.dispose();
      } catch {}
    });
    this.disposables = [];

    for (const listeners of this.modelListeners.values()) {
      listeners.forEach((l) => {
        try {
          l.dispose();
        } catch {}
      });
    }
    this.modelListeners.clear();
  }

  getRelativePath(absolutePath: string): string {
    if (!this.activeWorkspacePath) return absolutePath;
    
    // Normalize paths to use forward slashes for consistency
    const abs = absolutePath.replace(/\\/g, "/");
    const ws = this.activeWorkspacePath.replace(/\\/g, "/");
    
    if (abs.startsWith(ws)) {
      let rel = abs.slice(ws.length);
      if (rel.startsWith("/")) rel = rel.slice(1);
      return rel;
    }
    return absolutePath;
  }
}

function toMonacoRange(lspRange: any): monaco.Range {
  return new monaco.Range(
    lspRange.start.line + 1,
    lspRange.start.character + 1,
    lspRange.end.line + 1,
    lspRange.end.character + 1
  );
}

function toLspPosition(monacoPosition: monaco.Position): { line: number; character: number } {
  return {
    line: monacoPosition.lineNumber - 1,
    character: monacoPosition.column - 1
  };
}

function toMonacoLocation(lspLocation: any): monaco.languages.Location {
  const uri = lspLocation.uri ?? lspLocation.targetUri;
  const range = lspLocation.range ?? lspLocation.targetSelectionRange ?? lspLocation.targetRange;
  return {
    uri: monaco.Uri.parse(uri),
    range: toMonacoRange(range)
  };
}

function toMonacoLocations(lspResult: any): monaco.languages.Location | monaco.languages.Location[] {
  return Array.isArray(lspResult) ? lspResult.map(toMonacoLocation) : toMonacoLocation(lspResult);
}

function languageForModel(model: monaco.editor.ITextModel): { languageId: string; server: LspLanguage } | null {
  const languageId = model.getLanguageId();
  const ext = model.uri.path.split(".").pop()?.toLowerCase() ?? "";

  if (languageId === "python" || ext === "py" || ext === "pyi") {
    return { languageId: "python", server: "python" };
  }

  if (languageId === "javascript" || ext === "js" || ext === "jsx") {
    return { languageId: "javascript", server: "typescript" };
  }

  if (languageId === "json" || ext === "json") {
    return { languageId: "json", server: "typescript" };
  }

  if (languageId === "typescript" || ext === "ts" || ext === "tsx") {
    return { languageId: "typescript", server: "typescript" };
  }

  return null;
}

function toMonacoHover(lspHover: any): monaco.languages.Hover {
  const contents: monaco.IMarkdownString[] = [];

  const addContent = (content: any) => {
    if (typeof content === "string") {
      contents.push({ value: content });
    } else if (content && typeof content === "object") {
      if (content.kind === "markdown") {
        contents.push({ value: content.value });
      } else if (content.value) {
        contents.push({
          value: `\`\`\`${content.language || ""}\n${content.value}\n\`\`\``
        });
      }
    }
  };

  if (Array.isArray(lspHover.contents)) {
    lspHover.contents.forEach(addContent);
  } else {
    addContent(lspHover.contents);
  }

  return {
    contents,
    range: lspHover.range ? toMonacoRange(lspHover.range) : undefined
  };
}

function toMonacoCompletionItem(
  lspItem: any,
  defaultRange: monaco.Range
): monaco.languages.CompletionItem {
  let insertText = lspItem.insertText || lspItem.label;
  let range = defaultRange;

  if (lspItem.textEdit) {
    insertText = lspItem.textEdit.newText;
    if (lspItem.textEdit.range) {
      range = toMonacoRange(lspItem.textEdit.range);
    }
  }

  let documentation: string | monaco.IMarkdownString | undefined;
  if (lspItem.documentation) {
    if (typeof lspItem.documentation === "string") {
      documentation = lspItem.documentation;
    } else if (typeof lspItem.documentation === "object") {
      documentation = { value: lspItem.documentation.value };
    }
  }

  const kind = lspItem.kind !== undefined ? lspItem.kind - 1 : 9;

  return {
    label: lspItem.label,
    kind,
    detail: lspItem.detail,
    documentation,
    insertText,
    insertTextRules:
      lspItem.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : monaco.languages.CompletionItemInsertTextRule.None,
    range,
    sortText: lspItem.sortText,
    filterText: lspItem.filterText,
    preselect: lspItem.preselect
  };
}

type ImportPathRequest = {
  currentFile: string;
  prefix: string;
  range: monaco.Range;
};

type ImportPathSuggestion = {
  label: string;
  insertText: string;
  isDirectory: boolean;
};

function getImportPathRequest(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  workspacePath: string
): ImportPathRequest | null {
  const uri = model.uri.toString();
  if (!uri.startsWith("file://")) {
    return null;
  }

  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const quoteIndex = Math.max(linePrefix.lastIndexOf("\""), linePrefix.lastIndexOf("'"));
  if (quoteIndex < 0) {
    return null;
  }

  const prefix = linePrefix.slice(quoteIndex + 1);
  if (!prefix.startsWith(".")) {
    return null;
  }

  const beforeQuote = linePrefix.slice(0, quoteIndex);
  if (!/\b(from|import|require)\b|\bimport\s*\($/.test(beforeQuote)) {
    return null;
  }

  const currentFile = getRelativePath(workspacePath, model.uri.fsPath || model.uri.path);
  if (!currentFile) {
    return null;
  }

  return {
    currentFile,
    prefix,
    range: new monaco.Range(
      position.lineNumber,
      quoteIndex + 2,
      position.lineNumber,
      position.column
    )
  };
}

function buildImportPathSuggestions(files: string[], request: ImportPathRequest): ImportPathSuggestion[] {
  const currentDir = dirname(request.currentFile);
  const prefix = request.prefix;
  const slashIndex = prefix.lastIndexOf("/");
  const typedDir = slashIndex >= 0 ? prefix.slice(0, slashIndex + 1) : "";
  const typedLeaf = slashIndex >= 0 ? prefix.slice(slashIndex + 1) : prefix;
  const targetDir = normalizeWorkspacePath(joinWorkspacePath(currentDir, typedDir || "."));
  const seen = new Set<string>();
  const suggestions: ImportPathSuggestion[] = [];

  for (const file of files) {
    if (file === request.currentFile) {
      continue;
    }

    const normalizedFile = normalizeWorkspacePath(file);
    const containingDir = dirname(normalizedFile);
    if (containingDir === targetDir) {
      const leaf = basename(normalizedFile);
      if (leaf.startsWith(typedLeaf)) {
        pushSuggestion(seen, suggestions, prefix, typedDir, importSpecifierLeaf(leaf), false);
      }
      continue;
    }

    const isInsideTargetDir = targetDir
      ? normalizedFile.startsWith(`${targetDir}/`)
      : normalizedFile.includes("/");
    if (isInsideTargetDir) {
      const rest = targetDir ? normalizedFile.slice(targetDir.length + 1) : normalizedFile;
      const directory = rest.split("/")[0];
      if (directory && directory.startsWith(typedLeaf)) {
        pushSuggestion(seen, suggestions, prefix, typedDir, directory, true);
      }
    }
  }

  return suggestions.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.label.localeCompare(b.label));
}

function pushSuggestion(
  seen: Set<string>,
  suggestions: ImportPathSuggestion[],
  prefix: string,
  typedDir: string,
  leaf: string,
  isDirectory: boolean
) {
  const insertText = `${typedDir}${leaf}${isDirectory ? "/" : ""}`;
  if (seen.has(insertText)) {
    return;
  }

  seen.add(insertText);
  suggestions.push({
    label: isDirectory ? `${leaf}/` : leaf,
    insertText,
    isDirectory
  });
}

function getRelativePath(workspacePath: string, absolutePath: string): string {
  const abs = normalizeWorkspacePath(absolutePath);
  const ws = normalizeWorkspacePath(workspacePath);
  if (!ws || !abs.startsWith(ws)) {
    return "";
  }
  return normalizeWorkspacePath(abs.slice(ws.length));
}

function normalizeWorkspacePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^file:\/\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function joinWorkspacePath(base: string, relative: string): string {
  const parts = base ? base.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function dirname(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function basename(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function importSpecifierLeaf(filename: string): string {
  return filename.replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/, "");
}

export const lspClient = new LspClientClass();
