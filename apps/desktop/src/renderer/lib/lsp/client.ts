import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { LspLanguage } from "@construct/domain";
import type { ConstructApi } from "../../../shared/api";

type Pending = { resolve(value: unknown): void; reject(error: Error): void };

/** Monaco addresses documents by its own URI scheme; the server needs a real
 *  `file://` URI rooted at the project. The two are converted at this boundary
 *  and nowhere else, so neither side has to know about the other's scheme. */
const toServerUri = (projectDirectory: string, relativePath: string) =>
  `file://${encodeURI(projectDirectory.replace(/\\/g, "/"))}/${encodeURI(relativePath)}`;

const LSP_TO_MONACO_SEVERITY: Record<number, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

type Range = { start: { line: number; character: number }; end: { line: number; character: number } };
const toMonacoRange = (range: Range): monaco.IRange => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
});

/**
 * One language server, driving Monaco directly.
 *
 * This talks LSP over the main process and answers Monaco's provider
 * interfaces from it, rather than going through monaco-languageclient. That
 * library is the more complete route, but v10 requires replacing the
 * `monaco-editor` package with `@codingame/monaco-vscode-editor-api` across
 * the whole application — a swap that would put the working editor at risk for
 * features Construct does not use. What is implemented here is what the editor
 * actually shows: diagnostics, completion, hover, and go-to-definition.
 */
export class LanguageClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly disposables: monaco.IDisposable[] = [];
  private unsubscribe: (() => void) | null = null;
  private readonly openDocuments = new Map<string, number>();
  private ready: Promise<void> | null = null;

  constructor(
    private readonly api: ConstructApi,
    private readonly sessionId: string,
    private readonly projectId: string,
    private readonly projectDirectory: string,
    private readonly language: LspLanguage,
  ) {}

  async start(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = (async () => {
      this.unsubscribe = this.api.onLanguageServerEvent((event) => {
        if (event.sessionId !== this.sessionId) return;
        if (event.kind === "message") this.receive(event.message as Record<string, unknown>);
        else this.settleAllPending(new Error("The language server stopped."));
      });

      await this.api.startLanguageServer({ projectId: this.projectId, sessionId: this.sessionId, language: this.language });

      await this.request("initialize", {
        processId: null,
        rootUri: `file://${encodeURI(this.projectDirectory)}`,
        workspaceFolders: [{ uri: `file://${encodeURI(this.projectDirectory)}`, name: "project" }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            publishDiagnostics: { relatedInformation: false },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] } },
            hover: { contentFormat: ["markdown", "plaintext"] },
            definition: { linkSupport: false },
          },
        },
      });
      this.notify("initialized", {});
      this.registerProviders();
    })();

    return this.ready;
  }

  /** Tells the server a file is open, or that its contents changed.
   *
   *  Full-document sync rather than incremental. Incremental is the protocol's
   *  efficient path, but it requires the client's idea of the document to stay
   *  exactly in step with the server's — and a single dropped change desyncs
   *  them permanently, producing diagnostics on the wrong lines. */
  sync(relativePath: string, text: string): void {
    const uri = toServerUri(this.projectDirectory, relativePath);
    const version = (this.openDocuments.get(uri) ?? 0) + 1;
    this.openDocuments.set(uri, version);

    if (version === 1) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: this.language, version, text },
      });
    } else {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
    this.unsubscribe?.();
    this.settleAllPending(new Error("The language server was closed."));
    void this.api.stopLanguageServer({ sessionId: this.sessionId });
  }

  /* ---- Protocol --------------------------------------------------------- */

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const settled = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    void this.api.sendToLanguageServer({ sessionId: this.sessionId, message: { jsonrpc: "2.0", id, method, params } });
    return settled;
  }

  private notify(method: string, params: unknown): void {
    void this.api.sendToLanguageServer({ sessionId: this.sessionId, message: { jsonrpc: "2.0", method, params } });
  }

  private receive(message: Record<string, unknown>): void {
    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (!pending) return;
      if (message.error) pending.reject(new Error(String((message.error as { message?: string }).message ?? "Language server error")));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") this.publishDiagnostics(message.params as never);

    /* Server-to-client requests are answered with null rather than ignored.
       A server that asks for a configuration and never hears back can block
       its own initialisation waiting. */
    if (typeof message.id === "number" && typeof message.method === "string") {
      void this.api.sendToLanguageServer({ sessionId: this.sessionId, message: { jsonrpc: "2.0", id: message.id, result: null } });
    }
  }

  private settleAllPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /* ---- Monaco ----------------------------------------------------------- */

  private publishDiagnostics(params: { uri: string; diagnostics: Array<{ range: Range; message: string; severity?: number; source?: string }> }): void {
    const relative = decodeURI(params.uri).replace(`file://${this.projectDirectory}/`, "");
    const model = monaco.editor.getModel(monaco.Uri.parse(`construct:///${relative}`));
    if (!model) return;

    monaco.editor.setModelMarkers(
      model,
      "construct-lsp",
      params.diagnostics.map((diagnostic) => ({
        ...toMonacoRange(diagnostic.range),
        message: diagnostic.message,
        severity: LSP_TO_MONACO_SEVERITY[diagnostic.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        source: diagnostic.source ?? this.language,
      })),
    );
  }

  private registerProviders(): void {
    const selector = { scheme: "construct" };
    const positionOf = (model: monaco.editor.ITextModel, position: monaco.Position) => ({
      textDocument: { uri: toServerUri(this.projectDirectory, model.uri.path.replace(/^\//, "")) },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
    });

    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        triggerCharacters: [".", '"', "'", "/", "@", "<", ":"],
        provideCompletionItems: async (model, position) => {
          const result = (await this.request("textDocument/completion", positionOf(model, position)).catch(() => null)) as
            | { items?: CompletionItem[] }
            | CompletionItem[]
            | null;
          const items = Array.isArray(result) ? result : (result?.items ?? []);
          const word = model.getWordUntilPosition(position);
          const range: monaco.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: items.map((item) => ({
              label: item.label,
              kind: (item.kind ?? 1) as monaco.languages.CompletionItemKind,
              insertText: item.insertText ?? item.label,
              detail: item.detail,
              documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
              sortText: item.sortText,
              range,
            })),
          };
        },
      }),

      monaco.languages.registerHoverProvider(selector, {
        provideHover: async (model, position) => {
          const result = (await this.request("textDocument/hover", positionOf(model, position)).catch(() => null)) as
            | { contents?: unknown; range?: Range }
            | null;
          const value = hoverText(result?.contents);
          if (!value) return null;
          return { contents: [{ value }], ...(result?.range ? { range: toMonacoRange(result.range) } : {}) };
        },
      }),

      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: async (model, position) => {
          const result = (await this.request("textDocument/definition", positionOf(model, position)).catch(() => null)) as
            | Array<{ uri: string; range: Range }>
            | { uri: string; range: Range }
            | null;
          if (!result) return null;

          const locations = Array.isArray(result) ? result : [result];
          return locations
            .map((location) => {
              const relative = decodeURI(location.uri).replace(`file://${this.projectDirectory}/`, "");
              /* Only files already open as models can be jumped to. Creating a
                 model here would put a file in the editor that the tab strip
                 knows nothing about. */
              const target = monaco.editor.getModel(monaco.Uri.parse(`construct:///${relative}`));
              return target ? { uri: target.uri, range: toMonacoRange(location.range) } : null;
            })
            .filter((location): location is monaco.languages.Location => location !== null);
        },
      }),
    );
  }
}

type CompletionItem = {
  label: string;
  kind?: number;
  insertText?: string;
  detail?: string;
  documentation?: string | { value: string };
  sortText?: string;
};

/** Hover contents arrive in three shapes across protocol versions. */
function hoverText(contents: unknown): string {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join("\n\n");
  const record = contents as { value?: string };
  return record.value ?? "";
}
