import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import {
  currentPlatform,
  type LanguageServerEntry,
  type ServerPlatform,
} from "../../shared/languageServers.js";

const requireFrom = createRequire(import.meta.url);

/** Where an installed server lives: one directory per catalog id, so removing
 *  one is removing a directory and nothing has to be tracked. */
export const serverDirectory = (root: string, id: string): string => path.join(root, "language-servers", id);

export type ServerState =
  /** Shipped with the app. */
  | { status: "bundled"; command: string }
  | { status: "installed"; command: string }
  | { status: "available" }
  /** The route needs something this machine does not have — npm, Go, Ruby — or
   *  the project publishes no asset for this platform. */
  | { status: "unavailable"; reason: string };

export type InstallProgress = { id: string; phase: "installing" | "done" | "failed"; detail: string };

/**
 * Obtaining language servers, by the route each project actually publishes.
 *
 * Nothing here knows what a language is. It downloads, extracts, or shells out
 * to a package manager, and hands back the path to an executable — which is the
 * entire contract `LspService` needs.
 *
 * Everything lands under Construct's own directory. Nothing is installed
 * globally, nothing is put on PATH, and uninstalling is deleting a folder: a
 * learner should be able to try Rust support and leave no trace of it on their
 * machine afterwards.
 */
export class ServerInstaller {
  /** In-flight installs, so a second click on a button that is already working
   *  joins the first rather than starting a competing download. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly emit: (progress: InstallProgress) => void,
  ) {}

  /** Where the executable for an installed server is, without checking that it
   *  is there. `state` is what answers that. */
  private commandFor(entry: LanguageServerEntry): string | null {
    const source = entry.source;
    if (source.via === "bundled") {
      try {
        return path.join(path.dirname(requireFrom.resolve(source.module)), source.entry);
      } catch {
        return null;
      }
    }
    const home = serverDirectory(this.root, entry.id);
    if (source.via === "npm") return path.join(home, "node_modules", ".bin", withExe(source.bin));
    if (source.via === "release") return path.join(home, withExe(source.bin));
    return path.join(home, "bin", withExe(source.bin));
  }

  /** Whether a server is ready, installable, or out of reach on this machine. */
  async state(entry: LanguageServerEntry): Promise<ServerState> {
    const command = this.commandFor(entry);
    if (entry.source.via === "bundled") {
      return command && (await exists(command)) ? { status: "bundled", command } : { status: "unavailable", reason: "Missing from this build of Construct." };
    }
    if (command && (await exists(command))) return { status: "installed", command };

    if (entry.source.via === "npm" && !(await onPath("npm"))) {
      return { status: "unavailable", reason: "Needs npm on your PATH. Install Node.js and reopen Construct." };
    }
    if (entry.source.via === "toolchain") {
      const [tool] = entry.source.probe;
      if (!(await onPath(tool!))) return { status: "unavailable", reason: `Needs ${entry.source.tool} on your PATH.` };
    }
    if (entry.source.via === "release") {
      const platform = currentPlatform(process.platform, process.arch);
      if (!platform || !entry.source.match[platform]) {
        return { status: "unavailable", reason: `${entry.name} publishes no build for this machine.` };
      }
    }
    return { status: "available" };
  }

  /** Installs a server, or joins the install already running for it. */
  install(entry: LanguageServerEntry): Promise<void> {
    const existing = this.running.get(entry.id);
    if (existing) return existing;

    const run = this.perform(entry)
      .then(() => this.emit({ id: entry.id, phase: "done", detail: `${entry.name} is ready.` }))
      .catch((cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : `Could not install ${entry.name}.`;
        this.emit({ id: entry.id, phase: "failed", detail });
        /* Half an install is worse than none: a directory with a partial
           download in it would read as installed on the next launch. */
        return rm(serverDirectory(this.root, entry.id), { force: true, recursive: true }).catch(() => undefined);
      })
      .finally(() => this.running.delete(entry.id));

    this.running.set(entry.id, run);
    return run;
  }

  async uninstall(entry: LanguageServerEntry): Promise<void> {
    if (entry.source.via === "bundled") return;
    await rm(serverDirectory(this.root, entry.id), { force: true, recursive: true });
  }

  private async perform(entry: LanguageServerEntry): Promise<void> {
    const source = entry.source;
    if (source.via === "bundled") return;

    const home = serverDirectory(this.root, entry.id);
    await rm(home, { force: true, recursive: true });
    await mkdir(home, { recursive: true });

    if (source.via === "npm") {
      this.emit({ id: entry.id, phase: "installing", detail: `Fetching ${source.package}…` });
      /* A private prefix with its own package.json, so npm treats this as a
         project of its own rather than walking up the filesystem and installing
         into whatever it finds — which, for somebody whose home directory is a
         repository, is their repository. */
      await writeFile(path.join(home, "package.json"), JSON.stringify({ name: `construct-${entry.id}`, private: true }, null, 2));
      await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error", source.package], home);
      return;
    }

    if (source.via === "toolchain") {
      this.emit({ id: entry.id, phase: "installing", detail: `Running ${source.install.join(" ")}…` });
      const [tool, ...rest] = source.install;
      /* Told where to put it rather than allowed to choose: `go install` would
         otherwise write to the learner's GOBIN, which is their machine, not
         Construct's. */
      await run(tool!, rest, home, { GOBIN: path.join(home, "bin"), GEM_HOME: home });
      return;
    }

    const platform = currentPlatform(process.platform, process.arch);
    const pattern = platform ? source.match[platform] : undefined;
    if (!pattern) throw new Error(`${entry.name} publishes no build for this machine.`);

    this.emit({ id: entry.id, phase: "installing", detail: `Finding the latest ${entry.name}…` });
    const asset = await latestAsset(source.repo, pattern);
    this.emit({ id: entry.id, phase: "installing", detail: `Downloading ${entry.name} ${asset.tag}…` });
    await download(asset.url, home, asset.name);
    await unpack(path.join(home, asset.name), home);

    const binary = path.join(home, withExe(source.bin));
    /* A project that publishes the bare executable names it after the platform
       it was built for — `marksman-macos`, `rust-analyzer-aarch64-apple-darwin`
       — and that name changes per platform and per release, so the catalog
       cannot name it. Whatever single file came out of the download is the
       server, so it is given the name the catalog does know. */
    if (!(await exists(binary))) await adoptLoneFile(home, binary);
    if (!(await exists(binary))) throw new Error(`${entry.name} did not contain ${source.bin}.`);
    /* An archive's mode bits do not survive every extractor, and a server that
       cannot be executed fails much later, as a spawn error with no cause. */
    await chmod(binary, 0o755).catch(() => undefined);
  }
}

/** Renames the one plain file in a directory to the name expected of it. Does
 *  nothing where there is any ambiguity about which file that would be. */
async function adoptLoneFile(into: string, wanted: string): Promise<void> {
  const entries = await readdir(into, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  if (files.length !== 1 || entries.length !== 1) return;
  await rename(path.join(into, files[0]!.name), wanted);
}

const withExe = (bin: string) => (process.platform === "win32" && !bin.endsWith(".exe") ? `${bin}.exe` : bin);

const exists = (target: string) => stat(target).then(() => true).catch(() => false);

const onPath = (tool: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    execFile(probe, [tool], (error) => resolve(!error));
  });

/** Runs an installer to completion, failing with whatever it printed. A package
 *  manager's own last line is a far better error than "exit code 1". */
function run(command: string, args: readonly string[], cwd: string, env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32" });
    let noise = "";
    child.stderr?.on("data", (chunk: Buffer) => { noise = `${noise}${String(chunk)}`.slice(-2000); });
    child.on("error", () => reject(new Error(`Could not run ${command}.`)));
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const last = noise.trim().split("\n").filter(Boolean).at(-1);
      reject(new Error(last ? `${command} failed: ${last}` : `${command} exited with ${code}.`));
    });
  });
}

/** The newest release asset matching a pattern, and the tag it came from. */
async function latestAsset(repo: string, pattern: string): Promise<{ url: string; name: string; tag: string }> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repo}.`);
  const release = (await response.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
  const test = new RegExp(pattern);
  const asset = release.assets?.find((candidate) => test.test(candidate.name));
  if (!asset) throw new Error(`The latest ${repo} release has no build for this machine.`);
  return { url: asset.browser_download_url, name: asset.name, tag: release.tag_name ?? "latest" };
}

async function download(url: string, into: string, name: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed with ${response.status}.`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path.join(into, name)));
}

/**
 * Extracts what was downloaded, flattening the single wrapper directory that
 * most archives have.
 *
 * `tar` and `unzip` are the system's, not a library's: both ship on macOS and
 * Linux, and Windows has had bsdtar as `tar.exe` since 2018. Bundling an
 * extractor to avoid calling the one already installed would be a dependency
 * with a CVE feed attached.
 */
async function unpack(archive: string, into: string): Promise<void> {
  const name = path.basename(archive).toLowerCase();

  if (name.endsWith(".gz") && !name.endsWith(".tar.gz")) {
    /* A bare gzipped binary — rust-analyzer ships this way. `gunzip` leaves the
       name minus the suffix, which is the binary itself. */
    await run("gzip", ["-d", "-f", archive], into);
    return;
  }
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
    await run("tar", ["-xzf", archive, "-C", into], into);
  } else if (name.endsWith(".zip")) {
    await run(process.platform === "win32" ? "tar" : "unzip", process.platform === "win32" ? ["-xf", archive, "-C", into] : ["-q", "-o", archive, "-d", into], into);
  } else {
    /* Not an archive at all: marksman and friends publish the executable
       directly, and it only needs its versioned name taken off. */
    return;
  }

  await rm(archive, { force: true });
  await flatten(into);
}

/**
 * Lifts a lone wrapper directory's contents up one level.
 *
 * Release tarballs almost always contain `project-1.2.3/…`, and the version in
 * that name means the path to the binary would change with every release — so
 * the catalog could not name it. Flattening once here is what lets `bin` be a
 * stable path.
 */
async function flatten(into: string): Promise<void> {
  const entries = await readdir(into, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0]!.isDirectory()) return;

  const wrapper = path.join(into, entries[0]!.name);
  const staging = await mkdtemp(path.join(os.tmpdir(), "construct-lsp-"));
  const moved = path.join(staging, "payload");
  await rename(wrapper, moved);
  for (const child of await readdir(moved)) await rename(path.join(moved, child), path.join(into, child));
  await rm(staging, { force: true, recursive: true });
}
