import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const tag = process.env.TAG?.trim() || `v${packageJson.version}`;
const version = tag.replace(/^v/, "");
const releaseDir = path.resolve(root, process.env.RELEASE_ARTIFACT_DIR || path.join("app", "release", version));
const notesFile = path.join(root, "docs", "releases", `${version}.md`);
const explicitPrerelease = process.env.IS_PRERELEASE?.trim();
const isPrerelease = explicitPrerelease
  ? explicitPrerelease === "true"
  : /-(alpha|beta|canary|dev|next|rc)(?:[.-]|$)/i.test(version);
const title = `Construct ${version}`;

ensureGhAuth();

if (!existsSync(releaseDir)) {
  throw new Error(`No release artifacts found in ${releaseDir}. Build a platform package first.`);
}

const artifacts = uniqueArtifactsByName(walk(releaseDir).filter(isReleaseArtifact));

if (artifacts.length === 0) {
  throw new Error(
    `No real release artifacts were found in ${releaseDir}. Build macOS, Windows, or Linux packages before publishing.`
  );
}

upsertRelease();

for (const artifact of artifacts) {
  run("gh", ["release", "upload", tag, artifact, "--clobber"]);
}

function ensureGhAuth() {
  const result = spawnSync("gh", ["auth", "status"], { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `GitHub CLI is not authenticated. Run "gh auth login -h github.com" and retry.\n${detail}`
    );
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (stat.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isReleaseArtifact(file) {
  const base = path.basename(file);
  if (base.endsWith(".blockmap")) return false;
  if (base.startsWith("builder-")) return false;
  // Tauri uses target-specific separators: Linux RPMs use `Construct-`,
  // while DMG, MSI, NSIS, DEB, and AppImage artifacts use `_` or `.`.
  if (!/^Construct(?:[-_.]|$)/.test(base)) return false;
  const allowed = [
    ".dmg",
    ".zip",
    ".exe",
    ".msi",
    ".AppImage",
    ".deb",
    ".rpm",
    ".snap",
    ".pkg",
    ".tar.gz"
  ];
  return allowed.some((ext) => base.endsWith(ext));
}

function uniqueArtifactsByName(files) {
  const seen = new Map();
  for (const file of files) {
    const base = path.basename(file);
    const previous = seen.get(base);
    if (previous) {
      throw new Error(
        `Release artifacts contain duplicate asset name "${base}".\n` +
          `First: ${previous}\nSecond: ${file}\n` +
          "Give each package target a unique artifactName before publishing."
      );
    }
    seen.set(base, file);
  }
  return [...seen.values()].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function upsertRelease() {
  const metadataArgs = ["--title", title];
  if (existsSync(notesFile)) {
    metadataArgs.push("--notes-file", notesFile);
  } else if (isPrerelease) {
    metadataArgs.push("--notes", "Automated canary pre-release build.");
  } else {
    metadataArgs.push("--notes", title);
  }

  const stateArgs = isPrerelease ? ["--prerelease", "--latest=false"] : ["--latest"];
  const view = spawnSync("gh", ["release", "view", tag], { cwd: root, stdio: "ignore" });
  if (view.status === 0) {
    run("gh", ["release", "edit", tag, ...metadataArgs, ...stateArgs]);
    return;
  }

  run("gh", ["release", "create", tag, ...metadataArgs, ...stateArgs]);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}
