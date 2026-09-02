import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A project's files at a moment, so a turn can be undone.
 *
 * Editing an earlier message means the turns after it never happened — and
 * those turns wrote files. Rewinding the conversation without rewinding the
 * disk would leave the learner with code the transcript no longer explains,
 * which is worse than not offering the edit at all.
 *
 * Content-addressed, so the cost is what actually changed. A snapshot is a list
 * of paths and hashes; the bytes live once per distinct content, shared by
 * every snapshot that contains them. Twenty turns over one project is twenty
 * manifests and one copy of each file version.
 *
 * `.construct` is deliberately *not* ignored: Flow Memory is written by the
 * agent as part of a turn, so undoing the turn has to undo that too.
 */
export type SnapshotFile = { path: string; hash: string; bytes: number };

/** Never worth snapshotting. Build output and dependency trees are derived, and
 *  copying them would make an undo cost more than the work it undoes. */
const IGNORED = new Set([".git", "node_modules", ".next", "dist", "out", "build", ".turbo", "__pycache__", ".venv", "venv", ".DS_Store"]);

/** A single file above this is not the learner's source; it is an artefact that
 *  wandered in. Skipped rather than stored, and skipped on restore too — see
 *  `restore`. */
const MAX_FILE_BYTES = 2_000_000;
/** And a ceiling for the whole snapshot, so one enormous project cannot make
 *  every turn expensive. Past it the snapshot is abandoned: a partial snapshot
 *  is worse than none, because restoring one would delete what it failed to
 *  record. */
const MAX_TOTAL_BYTES = 64_000_000;

export type Capture = { files: SnapshotFile[]; blobs: Map<string, Buffer> } | null;

export class SnapshotService {
  /**
   * Reads the project as it is now.
   *
   * Returns null when the project is too large to snapshot, which the caller
   * treats as "no undo point" rather than as an error — the turn should still
   * run.
   */
  async capture(root: string): Promise<Capture> {
    const files: SnapshotFile[] = [];
    const blobs = new Map<string, Buffer>();
    let total = 0;

    const walk = async (directory: string): Promise<boolean> => {
      const entries = await readdir(path.join(root, directory), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        const relative = directory ? `${directory}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!(await walk(relative))) return false;
          continue;
        }
        /* Symlinks are recorded by neither path nor target: following one can
           leave the project, and restoring one is a decision about the link
           rather than about the file. */
        if (!entry.isFile()) continue;

        const body = await readFile(path.join(root, relative)).catch(() => null);
        if (!body || body.byteLength > MAX_FILE_BYTES) continue;

        total += body.byteLength;
        if (total > MAX_TOTAL_BYTES) return false;

        const hash = createHash("sha256").update(body).digest("hex");
        files.push({ path: relative, hash, bytes: body.byteLength });
        if (!blobs.has(hash)) blobs.set(hash, body);
      }
      return true;
    };

    if (!(await walk(""))) return null;
    return { files, blobs };
  }

  /**
   * Puts the project back to a snapshot.
   *
   * Three passes, and the order matters: write what the snapshot has, then
   * delete what it does not, then leave everything it never looked at alone. A
   * file the agent created during an undone turn is deleted; a file too large
   * to have been captured is untouched, because the snapshot has nothing to say
   * about it and deleting on that silence would destroy the learner's data.
   */
  async restore(root: string, files: SnapshotFile[], read: (hash: string) => Buffer | null): Promise<void> {
    const wanted = new Map(files.map((file) => [file.path, file]));

    for (const file of files) {
      const body = read(file.hash);
      /* A missing blob means the snapshot is incomplete, and writing the rest
         would leave a half-restored tree presented as a whole one. */
      if (!body) throw new Error("That snapshot is missing part of the project and cannot be restored.");
      const absolute = path.join(root, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, body);
    }

    for (const present of await this.list(root)) {
      if (wanted.has(present)) continue;
      await rm(path.join(root, present), { force: true }).catch(() => undefined);
    }
  }

  /** Every file a capture would have recorded, by path. Used to find what has
   *  appeared since — restoring deletes exactly those. */
  private async list(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(path.join(root, directory), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        const relative = directory ? `${directory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(relative);
          continue;
        }
        if (!entry.isFile()) continue;
        /* The same size filter capture applies. A file too large to be recorded
           must not be deleted on restore: the snapshot never had an opinion
           about it, and acting on that silence would destroy the learner's
           data. */
        const info = await stat(path.join(root, relative)).catch(() => null);
        if (info && info.size <= MAX_FILE_BYTES) found.push(relative);
      }
    };
    await walk("");
    return found;
  }
}
