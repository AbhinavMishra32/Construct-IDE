// Stage the minimal Mastra worker and a self-contained Node runtime for Tauri.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(appDir, "src-tauri");
const tripleMatch = execFileSync("rustc", ["-Vv"], { encoding: "utf8" }).match(/host:\s*(\S+)/);
if (!tripleMatch) throw new Error("Could not determine host target triple from rustc -Vv");
const triple = tripleMatch[1];
const isWin = process.platform === "win32";
const exeSuffix = isWin ? ".exe" : "";
const binariesDir = join(tauriDir, "binaries");
const runtimeBin = join(binariesDir, `construct-mastra-${triple}${exeSuffix}`);
mkdirSync(binariesDir, { recursive: true });

await stageNodeRuntime();
const builtWorker = join(appDir, "dist", "mastra-worker.cjs");
if (!existsSync(builtWorker)) throw new Error("dist/mastra-worker.cjs not found. Run pnpm build:mastra first.");
const resourcesDir = join(tauriDir, "resources");
mkdirSync(resourcesDir, { recursive: true });
copyFileSync(builtWorker, join(resourcesDir, "mastra-worker.cjs"));
console.log("[prepare-mastra] staged mastra-worker.cjs");

async function stageNodeRuntime() {
  const version = process.versions.node;
  const marker = join(binariesDir, ".mastra-node-version");
  if (existsSync(runtimeBin) && existsSync(marker) && readFileSync(marker, "utf8").trim() === version) return;
  const nodeOs = { darwin: "darwin", linux: "linux", win32: "win" }[process.platform];
  const nodeArch = { arm64: "arm64", x64: "x64" }[process.arch];
  if (!nodeOs || !nodeArch) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  const distName = `node-v${version}-${nodeOs}-${nodeArch}`;
  const extension = isWin ? "zip" : "tar.gz";
  const cacheDir = join(binariesDir, ".cache");
  const extracted = join(cacheDir, distName, isWin ? "node.exe" : join("bin", "node"));
  mkdirSync(cacheDir, { recursive: true });
  try {
    if (!existsSync(extracted)) {
      const archive = join(cacheDir, `${distName}.${extension}`);
      const response = await fetch(`https://nodejs.org/dist/v${version}/${distName}.${extension}`);
      if (!response.ok || !response.body) throw new Error(`Node download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
      const result = spawnSync("tar", ["-xf", archive, "-C", cacheDir], { stdio: "inherit" });
      if (result.status !== 0) throw new Error("Failed to extract Node runtime");
    }
    copyFileSync(extracted, runtimeBin);
  } catch (error) {
    console.warn(`[prepare-mastra] portable runtime unavailable (${error.message}); using local Node`);
    copyFileSync(process.execPath, runtimeBin);
  }
  if (!isWin) chmodSync(runtimeBin, 0o755);
  writeFileSync(marker, `${version}\n`);
}
