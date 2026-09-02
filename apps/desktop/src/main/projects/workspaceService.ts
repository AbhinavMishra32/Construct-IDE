import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceEntry } from "../../shared/api.js";

/** Directories that are never worth showing and expensive to walk. A file tree
 *  that opens onto node_modules is not a file tree. */
const IGNORED = new Set([".git", "node_modules", ".next", "dist", "out", "build", ".turbo", "__pycache__", ".venv", "venv", ".DS_Store"]);

/** Above this, a file is not something the editor should try to open. Monaco
 *  will attempt it and stall the renderer; saying so is the better answer. */
export const MAX_EDITABLE_BYTES = 2_000_000;

/**
 * Reading and writing inside one project directory.
 *
 * Every path that crosses from the renderer goes through `resolveInside`. The
 * containment check is the whole point of this class: the renderer names a
 * relative path, and nothing it can name may resolve outside the project it
 * named — not through `..`, not through an absolute path, and not through a
 * symlink pointing out of the tree.
 */
export class WorkspaceService {
  /**
   * Resolves a project-relative path to an absolute one, or throws.
   *
   * Ported from v0.7, where it guarded the same boundary. The three rejected
   * shapes are absolute paths, a bare `..`, and anything starting `../` — and
   * then the resolved result is checked against the root again, because
   * normalisation alone does not catch every way of walking out.
   */
  resolveInside(root: string, relativePath: string): string {
    const workspace = path.resolve(root);
    const normalized = path.normalize(relativePath);

    if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
      throw new Error(`Invalid project file path: ${relativePath}`);
    }

    const resolved = path.resolve(workspace, normalized);
    if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
      throw new Error(`Project file escaped its folder: ${relativePath}`);
    }

    return resolved;
  }

  /**
   * `resolveInside`, plus the check that string comparison cannot make.
   *
   * A path can be perfectly well-formed and still leave the project, because a
   * symlink inside it points out. `resolveInside` compares strings and sees
   * nothing wrong with `link.txt`; only asking the filesystem where it really
   * goes catches it. Every operation that touches a file on disk goes through
   * this rather than the string check alone.
   *
   * The nearest existing ancestor is what gets resolved, so creating a new file
   * is checked against the directory it would be created in — a new path has no
   * real location of its own yet, and refusing to create anything would be the
   * wrong reading of that.
   *
   * The root is resolved too. On macOS a temporary directory is reached through
   * /tmp, which is itself a symlink to /private/tmp, so comparing a resolved
   * target against an unresolved root would reject the project's own files.
   */
  async resolveInsideReal(root: string, relativePath: string): Promise<string> {
    const absolute = this.resolveInside(root, relativePath);
    const realRoot = await realpath(root);

    let existing = absolute;
    while (!existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error(`Invalid project file path: ${relativePath}`);
      existing = parent;
    }

    const real = await realpath(existing);
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`Project file escaped its folder: ${relativePath}`);
    }

    return absolute;
  }

  /**
   * One level of the tree, directories first then alphabetical.
   *
   * Deliberately not recursive. v0.7 walked the whole tree on every listing,
   * which on a real repository means thousands of stat calls before the first
   * folder can be drawn. The renderer asks for a directory when the learner
   * opens it, so a large project costs the same as a small one.
   */
  async list(root: string, directory = ""): Promise<WorkspaceEntry[]> {
    const absolute = await this.resolveInsideReal(root, directory || ".").catch(() => null);
    const entries = absolute ? await readdir(absolute, { withFileTypes: true }).catch(() => []) : [];

    return entries
      .filter((entry) => !IGNORED.has(entry.name) && !entry.name.startsWith("."))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        /* POSIX separators on the wire regardless of host, so a path the
           renderer round-trips is the same string on Windows and macOS. */
        path: directory ? `${directory.split(path.sep).join("/")}/${entry.name}` : entry.name,
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      }));
  }

  async read(root: string, relativePath: string): Promise<string> {
    const absolute = await this.resolveInsideReal(root, relativePath);
    const info = await stat(absolute);

    if (info.isDirectory()) throw new Error(`${relativePath} is a folder.`);
    /* Checked before reading rather than after. Reading a 400MB file into a
       string to discover it is too large is the failure it is meant to
       prevent. */
    if (info.size > MAX_EDITABLE_BYTES) {
      throw new Error(`${relativePath} is ${Math.round(info.size / 1_000_000)}MB — too large to open in the editor.`);
    }

    return readFile(absolute, "utf8");
  }

  async write(root: string, relativePath: string, content: string): Promise<void> {
    const absolute = await this.resolveInsideReal(root, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  async createFile(root: string, relativePath: string): Promise<void> {
    const absolute = await this.resolveInsideReal(root, relativePath);
    /* Never truncate. "New file" landing on an existing name would silently
       destroy whatever was there. */
    if (existsSync(absolute)) throw new Error(`${relativePath} already exists.`);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, "", "utf8");
  }

  async createDirectory(root: string, relativePath: string): Promise<void> {
    await mkdir(await this.resolveInsideReal(root, relativePath), { recursive: true });
  }

  async rename(root: string, from: string, to: string): Promise<void> {
    const source = await this.resolveInsideReal(root, from);
    const target = await this.resolveInsideReal(root, to);
    if (existsSync(target)) throw new Error(`${to} already exists.`);
    await rename(source, target);
  }

  /** Deletes inside the project. This is the learner acting on their own file
   *  through the file tree, unlike removing a project, which never deletes. */
  async remove(root: string, relativePath: string): Promise<void> {
    await rm(await this.resolveInsideReal(root, relativePath), { recursive: true, force: true });
  }
}
