// Stages the Node sidecar for Tauri: places the Node runtime as the
// target-triple-named externalBin and copies the bundled sidecar.cjs into the
// Tauri resources directory. Run after `tsup --config tsup.sidecar.config.ts`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const exeSuffix = process.platform === "win32" ? ".exe" : "";

// 1. Node runtime as the externalBin (Tauri requires the <triple> suffix).
const binariesDir = join(tauriDir, "binaries");
mkdirSync(binariesDir, { recursive: true });
const sidecarBin = join(binariesDir, `construct-sidecar-${triple}${exeSuffix}`);
const nodePath = process.execPath;
const needsCopy =
  !existsSync(sidecarBin) || statSync(sidecarBin).size !== statSync(nodePath).size;
if (needsCopy) {
  copyFileSync(nodePath, sidecarBin);
  console.log(`[prepare-sidecar] staged node runtime -> ${sidecarBin}`);
} else {
  console.log("[prepare-sidecar] node runtime already staged");
}

// 2. Bundled sidecar.cjs as a Tauri resource.
const builtSidecar = join(appDir, "dist", "sidecar.cjs");
if (!existsSync(builtSidecar)) {
  throw new Error(
    "dist/sidecar.cjs not found. Run `pnpm build:sidecar` before prepare-sidecar."
  );
}
const resourcesDir = join(tauriDir, "resources");
mkdirSync(resourcesDir, { recursive: true });
copyFileSync(builtSidecar, join(resourcesDir, "sidecar.cjs"));
console.log("[prepare-sidecar] copied sidecar.cjs -> src-tauri/resources/sidecar.cjs");
