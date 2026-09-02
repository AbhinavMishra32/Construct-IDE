import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  registerFileSystemOverlay,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat,
} from "@codingame/monaco-vscode-files-service-override";
import { Emitter } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { ConstructApi } from "../../../shared/api";

/**
 * The disk, as the editor platform sees it.
 *
 * The editor asks for a file whenever it has to show one it is not already
 * displaying — the preview under a control-click, the peek window, the target
 * of a definition. Without a provider for `file://` every one of those asks
 * fails, and the failure is silent: no preview appears, no link is drawn, and
 * control-clicking `console.log` does nothing at all. That is the whole of the
 * "go to definition doesn't work" report — the definition was found, and then
 * there was nothing that could open it.
 *
 * Read-only on purpose. Definitions lead out of the project as often as into
 * it, so this reads by absolute path; making it writable as well would hand the
 * renderer the disk. The learner's own edits never come through here — those go
 * to the project's own write path, which still checks that the file is inside
 * the project it claims to be in.
 */
class SourceFileSystem extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.Readonly |
    FileSystemProviderCapabilities.PathCaseSensitive;

  private readonly changeCapabilities = this._register(new Emitter<void>());
  readonly onDidChangeCapabilities = this.changeCapabilities.event;

  /* Nothing watches the disk on Construct's behalf, so this never fires. A file
     the learner is editing is already a model the editor owns; a file it read
     to draw a preview is one it will read again next time. */
  private readonly changeFile = this._register(new Emitter<never[]>());
  readonly onDidChangeFile = this.changeFile.event;

  constructor(private readonly api: ConstructApi) {
    super();
  }

  watch() {
    return { dispose: () => undefined };
  }

  async stat(resource: URI): Promise<IStat> {
    const info = await this.call(resource, (path) => this.api.statSource({ path }));
    return {
      type: info.type === "directory" ? FileType.Directory : FileType.File,
      ctime: info.mtime,
      mtime: info.mtime,
      size: info.size,
    };
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const entries = await this.call(resource, (path) => this.api.listSource({ path }));
    return entries.map((entry) => [entry.name, entry.type === "directory" ? FileType.Directory : FileType.File]);
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const content = await this.call(resource, (path) => this.api.readSource({ path }));
    return new TextEncoder().encode(content);
  }

  /* Everything that would change the disk. Refused rather than omitted, so a
     caller that tries gets the error the file service understands instead of a
     crash halfway through an operation. */
  async writeFile(): Promise<void> {
    throw FileSystemProviderError.create("Construct opens files outside the project read-only.", FileSystemProviderErrorCode.NoPermissions);
  }
  async mkdir(): Promise<void> {
    throw FileSystemProviderError.create("Construct opens files outside the project read-only.", FileSystemProviderErrorCode.NoPermissions);
  }
  async delete(): Promise<void> {
    throw FileSystemProviderError.create("Construct opens files outside the project read-only.", FileSystemProviderErrorCode.NoPermissions);
  }
  async rename(): Promise<void> {
    throw FileSystemProviderError.create("Construct opens files outside the project read-only.", FileSystemProviderErrorCode.NoPermissions);
  }

  /** One place to turn a URI into a path and a failure into the code the file
   *  service reads — a missing file has to arrive as `FileNotFound`, or the
   *  editor reports a broken file system rather than a stale path. */
  private async call<T>(resource: URI, run: (path: string) => Promise<T>): Promise<T> {
    try {
      return await run(resource.fsPath);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw FileSystemProviderError.create(message, FileSystemProviderErrorCode.FileNotFound);
    }
  }
}

/** Puts the disk in front of the platform's own in-memory `file://` provider.
 *  Priority one is enough: there is only ever this one overlay. */
export function installSourceFileSystem(api: ConstructApi): void {
  registerFileSystemOverlay(1, new SourceFileSystem(api));
}
