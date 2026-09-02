import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { MonacoLanguageClient } from "monaco-languageclient";
import { AbstractMessageReader, AbstractMessageWriter, type DataCallback, type Disposable, type Message, type MessageReader, type MessageWriter } from "vscode-jsonrpc/browser.js";
import { CloseAction, ErrorAction } from "vscode-languageclient/browser.js";

import type { LanguageServerEntry } from "../../../shared/languageServers";
import type { ConstructApi } from "../../../shared/api";

/**
 * One language server, wired to the editor.
 *
 * This used to be four hundred lines of hand-written protocol: a request map,
 * a diagnostics translator, and one Monaco provider per feature — which meant
 * the editor knew exactly as much about a language as somebody had found time
 * to implement. It is `monaco-languageclient` now. Everything a server offers
 * arrives at once, including the things that were never going to be written by
 * hand: rename, references, code actions, formatting, signature help, document
 * symbols, semantic tokens.
 *
 * What is left here is the transport. The server itself runs in the main
 * process, so the two ends of the connection are a reader and a writer over the
 * IPC channel it already exposes.
 */
export class LanguageClient {
  private client: MonacoLanguageClient | null = null;
  private ready: Promise<void> | null = null;
  private reader: IpcReader | null = null;

  constructor(
    private readonly api: ConstructApi,
    private readonly sessionId: string,
    private readonly projectId: string,
    private readonly directory: string,
    private readonly entry: LanguageServerEntry,
  ) {}

  async start(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = (async () => {
      /* Listening before starting. A server that is quick off the mark can
         publish before the renderer has come back round the event loop, and a
         message that arrives with no reader attached is simply lost. */
      const reader = new IpcReader(this.api, this.sessionId);
      this.reader = reader;
      await this.api.startLanguageServer({ projectId: this.projectId, sessionId: this.sessionId, serverId: this.entry.id });

      const folder = monaco.Uri.file(this.directory);
      this.client = new MonacoLanguageClient({
        id: this.sessionId,
        name: this.entry.name,
        messageTransports: { reader, writer: new IpcWriter(this.api, this.sessionId) },
        clientOptions: {
          documentSelector: this.entry.languages.map((language) => ({ language, scheme: "file" })),
          /* Given explicitly because Construct has no workbench under it, so
             there are no workspace folders for the client to discover. Without
             this a server indexes nothing and answers about nothing. */
          workspaceFolder: { uri: folder, name: "project", index: 0 },
          /* A language server failing is not the editor failing. The file is
             still open and editable either way, so both of these give up
             quietly rather than restarting a server that cannot run. */
          errorHandler: {
            error: () => ({ action: ErrorAction.Continue }),
            closed: () => ({ action: CloseAction.DoNotRestart }),
          },
        },
      });

      await this.client.start();
    })();

    return this.ready;
  }

  dispose(): void {
    /* Stopped rather than disposed, and unawaited: `stop` negotiates a
       shutdown with a process that may already be gone, and the session is
       killed on the other side regardless. */
    void this.client?.stop().catch(() => undefined);
    this.client = null;
    this.reader?.dispose();
    this.reader = null;
    void this.api.stopLanguageServer({ sessionId: this.sessionId });
  }
}

/* ---- Transport -----------------------------------------------------------
   The main process frames and unframes LSP's `Content-Length` protocol, so
   what crosses IPC is a parsed message rather than bytes. That is exactly the
   granularity `vscode-jsonrpc` reads and writes at, which is why these two are
   as short as they are. */

class IpcReader extends AbstractMessageReader implements MessageReader {
  private unsubscribe: (() => void) | null = null;
  /** Messages that arrived before `listen` was called. The client attaches its
   *  callback during `start`, which is after the server is already running. */
  private queued: Message[] = [];
  private callback: DataCallback | null = null;

  constructor(api: ConstructApi, sessionId: string) {
    super();
    this.unsubscribe = api.onLanguageServerEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.kind !== "message") {
        this.fireClose();
        return;
      }
      const message = event.message as Message;
      if (this.callback) this.callback(message);
      else this.queued.push(message);
    });
  }

  listen(callback: DataCallback): Disposable {
    this.callback = callback;
    for (const message of this.queued.splice(0)) callback(message);
    return { dispose: () => (this.callback = null) };
  }

  override dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.callback = null;
    super.dispose();
  }
}

class IpcWriter extends AbstractMessageWriter implements MessageWriter {
  constructor(
    private readonly api: ConstructApi,
    private readonly sessionId: string,
  ) {
    super();
  }

  async write(message: Message): Promise<void> {
    await this.api.sendToLanguageServer({ sessionId: this.sessionId, message });
  }

  end(): void {}
}
