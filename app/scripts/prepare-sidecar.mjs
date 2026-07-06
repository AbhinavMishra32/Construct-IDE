// Stages the Node sidecar for Tauri: places a self-contained Node runtime as
// the target-triple-named externalBin and copies the bundled sidecar.cjs into
// the Tauri resources directory. Run after `tsup --config tsup.sidecar.config.ts`.
//
// It downloads the official standalone Node.js build matching the current
// Node version rather than copying the local `node` binary. The local binary
// is not portable on every platform — Homebrew/`--shared` macOS builds link
// @rpath/libnode.<abi>.dylib dynamically, so a bare copy fails to launch once
// moved. Official nodejs.org builds are single self-contained executables.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(appDir, "src-tauri");

function hostTargetTriple() {
  const output = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
  const match = output.match(/host:\s*(\S+)/);
  if (!match) throw new Error("Could not determine host target triple from rustc -Vv");
  return match[1];
}

const triple = hostTargetTriple();
const isWin = process.platform === "win32";
const exeSuffix = isWin ? ".exe" : "";
const binariesDir = join(tauriDir, "binaries");
mkdirSync(binariesDir, { recursive: true });
const sidecarBin = join(binariesDir, `construct-sidecar-${triple}${exeSuffix}`);

// 1. Self-contained Node runtime as the externalBin.
await stageNodeRuntime();

// 2. Bundled sidecar.cjs as a Tauri resource.
const builtSidecar = join(appDir, "dist", "sidecar.cjs");
if (!existsSync(builtSidecar)) {
  throw new Error("dist/sidecar.cjs not found. Run `pnpm build:sidecar` before prepare-sidecar.");
}
const resourcesDir = join(tauriDir, "resources");
mkdirSync(resourcesDir, { recursive: true });
copyFileSync(builtSidecar, join(resourcesDir, "sidecar.cjs"));
console.log("[prepare-sidecar] copied sidecar.cjs -> src-tauri/resources/sidecar.cjs");

async function stageNodeRuntime() {
  const version = process.versions.node; // match the dev Node so node-pty's ABI matches.
  const marker = join(binariesDir, ".node-version");
  if (
    existsSync(sidecarBin) &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === version
  ) {
    console.log(`[prepare-sidecar] sidecar Node ${version} already staged`);
    return;
  }

  const nodeOs = { darwin: "darwin", linux: "linux", win32: "win" }[process.platform];
  const nodeArch = { arm64: "arm64", x64: "x64" }[process.arch];
  if (!nodeOs || !nodeArch) {
    throw new Error(`Unsupported platform for sidecar: ${process.platform}/${process.arch}`);
  }

  const distName = `node-v${version}-${nodeOs}-${nodeArch}`;
  const archiveExt = isWin ? "zip" : "tar.gz";
  const url = `https://nodejs.org/dist/v${version}/${distName}.${archiveExt}`;
  const cacheDir = join(binariesDir, ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const extractedNode = join(cacheDir, distName, isWin ? "node.exe" : join("bin", "node"));

  try {
    if (!existsSync(extractedNode)) {
      const archivePath = join(cacheDir, `${distName}.${archiveExt}`);
      console.log(`[prepare-sidecar] downloading self-contained Node ${version}: ${url}`);
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(archivePath));
      // bsdtar (macOS/Windows) and GNU tar (Linux) both extract .tar.gz with -xf;
      // bsdtar also extracts .zip, which is the Windows dist format.
      const untar = spawnSync("tar", ["-xf", archivePath, "-C", cacheDir], { stdio: "inherit" });
      if (untar.status !== 0) throw new Error("failed to extract Node archive");
    }
    copyFileSync(extractedNode, sidecarBin);
  } catch (err) {
    // Fallback: copy the local runtime (works where it is self-contained, e.g.
    // Linux or official macOS builds). May fail for Homebrew's shared libnode.
    console.warn(`[prepare-sidecar] official download unavailable (${err.message}); copying local node`);
    copyFileSync(process.execPath, sidecarBin);
  }

  if (!isWin) chmodSync(sidecarBin, 0o755);
  writeFileSync(marker, `${version}\n`);
  console.log(`[prepare-sidecar] staged self-contained Node ${version} -> ${sidecarBin}`);
}
