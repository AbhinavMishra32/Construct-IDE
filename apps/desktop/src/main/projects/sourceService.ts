import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceEntry, SourceStat } from "../../shared/api.js";

/** The same ceiling the project's own files have. A definition that lands in a
 *  generated 40MB bundle is not one the editor should try to draw. */
const MAX_SOURCE_BYTES = 2_000_000;

/**
 * Reading source files anywhere on disk, and never writing any of them.
 *
 * The workspace service exists to keep the renderer inside one project
 * directory, and that is right for everything the learner edits. It is wrong
 * for the one thing the editor has to do to be an editor: follow a symbol to
 * where it is declared. `console.log` is declared in a `.d.ts` under
 * node_modules; `json.loads` is in the Python installation. Neither is inside
 * the project, and refusing to read them is what made control-click do nothing.
 *
 * So this reads by absolute path — and only reads. Nothing here writes,
 * renames or deletes, so widening the path does not widen what can be changed:
 * a definition opens read-only, and saving still goes through the workspace
 * service and its containment check.
 */
export class SourceService {
  async stat(target: string): Promise<SourceStat> {
    const info = await stat(target);
    return {
      type: info.isDirectory() ? "directory" : "file",
      size: info.isDirectory() ? 0 : info.size,
      mtime: Math.round(info.mtimeMs),
    };
  }

  async read(target: string): Promise<string> {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error(`${path.basename(target)} is a folder.`);
    if (info.size > MAX_SOURCE_BYTES) {
      throw new Error(`${path.basename(target)} is ${Math.round(info.size / 1_000_000)}MB — too large to open.`);
    }
    return readFile(target, "utf8");
  }

  async list(target: string): Promise<SourceEntry[]> {
    const entries = await readdir(target, { withFileTypes: true });
    return entries.map((entry) => ({
      path: path.join(target, entry.name),
      name: entry.name,
      type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
  }
}
