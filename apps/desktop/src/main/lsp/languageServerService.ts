import { LANGUAGE_SERVERS, serverById } from "../../shared/languageServers.js";
import type { LanguageServerInstallEvent, LanguageServerStatus } from "../../shared/api.js";
import type { ServerCommand } from "./lspService.js";
import { ServerInstaller } from "./serverInstaller.js";

/**
 * The catalog, as the window sees it.
 *
 * One object between the settings page and the installer, so the renderer never
 * learns what a release asset is or which package manager a server comes from —
 * it asks for a list of rows and presses buttons on them.
 */
export class LanguageServerService {
  private readonly installer: ServerInstaller;
  /** Ids with an install in flight, so a row can say so and a second press
   *  cannot start a competing download. */
  private readonly installing = new Set<string>();

  constructor(root: string, private readonly emit: (event: LanguageServerInstallEvent) => void) {
    this.installer = new ServerInstaller(root, (progress) => this.emit(progress));
  }

  /** Every row of Settings → Languages, in catalog order. */
  async list(): Promise<LanguageServerStatus[]> {
    return Promise.all(
      LANGUAGE_SERVERS.map(async (entry) => {
        const state = await this.installer.state(entry);
        return {
          id: entry.id,
          name: entry.name,
          blurb: entry.blurb,
          extensions: entry.extensions,
          via: entry.source.via,
          state: state.status,
          ...(state.status === "unavailable" ? { reason: state.reason } : {}),
          installing: this.installing.has(entry.id),
        } satisfies LanguageServerStatus;
      }),
    );
  }

  /** The command for a server that is ready to run, or nothing. */
  async command(id: string): Promise<ServerCommand | null> {
    const entry = serverById(id);
    if (!entry) return null;
    const state = await this.installer.state(entry);
    if (state.status !== "installed" && state.status !== "bundled") return null;
    return { command: state.command, args: entry.args };
  }

  async install(id: string): Promise<void> {
    const entry = serverById(id);
    if (!entry) throw new Error("Construct has no server by that name.");
    this.installing.add(id);
    /* The row is told it is working before the first byte moves: resolving a
       release takes a round trip to GitHub, and a button that sits inert for
       two seconds is a button people press twice. */
    this.emit({ id, phase: "installing", detail: `Installing ${entry.name}…` });
    try {
      await this.installer.install(entry);
    } finally {
      this.installing.delete(id);
    }
  }

  async uninstall(id: string): Promise<void> {
    const entry = serverById(id);
    if (!entry) return;
    await this.installer.uninstall(entry);
  }
}
