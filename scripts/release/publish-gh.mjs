import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const releaseDir = path.join(root, "app", "release", version);
const notesFile = path.join(root, "docs", "releases", `${version}.md`);

ensureGhAuth();

if (!existsSync(releaseDir)) {
  throw new Error(`No release artifacts found in ${releaseDir}. Build a platform package first.`);
}

const artifacts = walk(releaseDir).filter((file) => {
  const base = path.basename(file);
  return !base.endsWith(".blockmap");
});

if (artifacts.length === 0) {
  throw new Error(`No artifacts were found in ${releaseDir}.`);
}

const view = spawnSync("gh", ["release", "view", tag], { cwd: root, stdio: "ignore" });
if (view.status !== 0) {
  const args = ["release", "create", tag, "--title", `Construct ${version}`];
  if (existsSync(notesFile)) {
    args.push("--notes-file", notesFile);
  } else {
    args.push("--notes", `Construct ${version}`);
  }
  run("gh", args);
}

run("gh", ["release", "upload", tag, ...artifacts, "--clobber"]);

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

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
  }
}
