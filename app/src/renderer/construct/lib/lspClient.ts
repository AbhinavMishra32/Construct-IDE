import { monaco } from "../../monaco";

class LspClientClass {
  private isInitialized = false;
  private disposables: monaco.IDisposable[] = [];
  private nextRequestId = 1;
  private activeWorkspacePath = "";
  private modelListeners = new Map<string, monaco.IDisposable[]>();

  async initialize(workspacePath: string) {
    if (this.isInitialized && this.activeWorkspacePath === workspacePath) {
      return;
    }

    this.dispose();
    this.activeWorkspacePath = workspacePath;
    this.isInitialized = true;

    console.log("[LSP Client] Initializing handshake for:", workspacePath);

    try {
      // 1. Send initialize request
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
            references: {
              dynamicRegistration: true
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: { valueSet: [1, 2] },
              versionSupport: true
            }
          }
        },
        workspaceFolders: [{
          uri: "file://" + workspacePath,
          name: workspacePath.split("/").pop() || "workspace"
        }]
      });

      // 2. Send initialized notification
      this.sendNotification("initialized", {});

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

  // JSON-RPC requests
  async sendRequest(method: string, params: any): Promise<any> {
    const id = this.nextRequestId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const response: any = await window.constructProjects.lspRequest(payload);
    if (response && response.error) {
      throw new Error(response.error.message || JSON.stringify(response.error));
    }
    return response ? response.result : null;
  }

  // JSON-RPC notifications
  sendNotification(method: string, params: any) {
    const payload = { jsonrpc: "2.0", method, params };
    window.constructProjects.lspRequest(payload).catch((err) => {
      console.error("[LSP Client] Notification error:", err);
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

    let languageId = "typescript";
    const ext = model.uri.path.split(".").pop() || "";
    if (ext === "js" || ext === "jsx") languageId = "javascript";
    else if (ext === "ts" || ext === "tsx") languageId = "typescript";
    else if (ext === "json") languageId = "json";

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: model.getVersionId(),
        text: model.getValue()
      }
    });
  }

  private changeModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri,
        version: model.getVersionId()
      },
      contentChanges: [{ text: model.getValue() }]
    });
  }

  private closeModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    this.sendNotification("textDocument/didClose", {
      textDocument: { uri }
    });

    monaco.editor.setModelMarkers(model, "lsp", []);
  }

  notifySaveModel(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (!uri.startsWith("file://")) return;

    this.sendNotification("textDocument/didSave", {
      textDocument: { uri }
    });
  }

  private setupDiagnostics() {
    const cleanup = window.constructProjects.onLspNotification((notification: any) => {
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
            source: d.source || "ts",
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
    const languages = ["typescript", "javascript", "json"];

    languages.forEach((lang) => {
      // 1. Hover
      this.disposables.push(
        monaco.languages.registerHoverProvider(lang, {
          provideHover: async (model, position) => {
            const uri = model.uri.toString();
            if (!uri.startsWith("file://")) return null;

            try {
              const res = await this.sendRequest("textDocument/hover", {
                textDocument: { uri },
                position: toLspPosition(position)
              });
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
              const res = await this.sendRequest("textDocument/definition", {
                textDocument: { uri },
                position: toLspPosition(position)
              });
              if (!res) return null;

              if (Array.isArray(res)) {
                return res.map(toMonacoLocation);
              }
              return toMonacoLocation(res);
            } catch (err) {
              console.error("[LSP Definition error]:", err);
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
              const res = await this.sendRequest("textDocument/references", {
                textDocument: { uri },
                position: toLspPosition(position),
                context: {
                  includeDeclaration: context.includeDeclaration
                }
              });
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
              const res = await this.sendRequest("textDocument/completion", {
                textDocument: { uri },
                position: toLspPosition(position),
                context: {
                  triggerKind: context.triggerKind,
                  triggerCharacter: context.triggerCharacter
                }
              });
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
  }

  dispose() {
    this.isInitialized = false;
    this.activeWorkspacePath = "";

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
  return {
    uri: monaco.Uri.parse(lspLocation.uri),
    range: toMonacoRange(lspLocation.range)
  };
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

export const lspClient = new LspClientClass();
