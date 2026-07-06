import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

const packageJson = readJson("package.json");
const appPackageJson = readJson("app/package.json");
const tauriConfig = readJson("app/src-tauri/tauri.conf.json");
const viteConfig = read("app/vite.config.ts");
const ciWorkflow = read(".github/workflows/ci.yml");
const releaseWorkflow = read(".github/workflows/release.yml");
const gitmodules = read(".gitmodules");
const copyCss = read("opaline/packages/ui/scripts/copy-css.mjs");
const publishScript = read("scripts/release/publish-gh.mjs");

check(packageJson.scripts?.["release:preflight"] === "node scripts/release/preflight.mjs", "package.json exposes release:preflight.");
check(packageJson.scripts?.["verify:no-build"]?.includes("release:preflight"), "package.json verify:no-build includes release:preflight.");
check(appPackageJson.name === "@construct/app", "app/package.json is readable and still points at @construct/app.");
check(packageJson.version === appPackageJson.version, "Root and app package versions stay aligned for release tags.");

check(exists("opaline/packages/ui/src"), "opaline/packages/ui/src exists for the @opaline/ui CSS copy step.");
check(
  /base:\s*["']\.\/["']/.test(viteConfig),
  "Vite renderer build uses relative asset URLs so the Tauri webview can load packaged assets."
);
check(
  copyCss.includes("dirname(dirname(fileURLToPath(import.meta.url)))") && !copyCss.includes(".replace(/\\/scripts$/"),
  "Opaline CSS copy script derives packageRoot with platform-safe path helpers."
);

// --- Tauri packaging configuration ----------------------------------------
check(exists("app/src-tauri/tauri.conf.json"), "Tauri config exists at app/src-tauri/tauri.conf.json.");
check(exists("app/src-tauri/Cargo.toml"), "Tauri Rust crate exists at app/src-tauri/Cargo.toml.");
check(tauriConfig.version === appPackageJson.version, "tauri.conf.json version stays aligned with app/package.json.");
check(tauriConfig.identifier === "cc.tryconstruct.desktop", "tauri.conf.json keeps the cc.tryconstruct.desktop identifier.");
check(
  Array.isArray(tauriConfig.bundle?.externalBin) && tauriConfig.bundle.externalBin.includes("binaries/construct-sidecar"),
  "tauri.conf.json bundles the Node sidecar as an external binary."
);
check(
  tauriConfig.build?.beforeBuildCommand?.includes("tauri:before-build"),
  "tauri.conf.json beforeBuildCommand runs the before-build step that stages the sidecar."
);
check(
  appPackageJson.scripts?.["tauri:before-build"]?.includes("sidecar:prepare"),
  "app tauri:before-build stages the sidecar before packaging."
);
check(exists("app/scripts/prepare-sidecar.mjs"), "prepare-sidecar.mjs exists to stage the Node runtime + sidecar bundle.");

check(gitmodules.includes('path = opaline'), ".gitmodules still declares the opaline submodule.");
check(
  gitmodules.includes("url = https://github.com/AbhinavMishra32/opaline-ui.git"),
  ".gitmodules points the opaline submodule at the public opaline-ui repository."
);
check(!/submodule "opaline"[\s\S]*?open-shell\.git/.test(gitmodules), ".gitmodules no longer points opaline at open-shell.");
if (gitmodules.includes("private/construct-cloud-backend")) {
  check(!ciWorkflow.includes("submodules: recursive"), "CI does not recursively clone the private backend submodule.");
  check(!releaseWorkflow.includes("submodules: recursive"), "Release does not recursively clone the private backend submodule.");
}
for (const [name, workflow] of [
  ["CI", ciWorkflow],
  ["Release", releaseWorkflow],
]) {
  check(workflow.includes("actions/checkout@v5"), `${name} uses actions/checkout@v5.`);
  if (workflow.includes("pnpm/action-setup")) {
    check(workflow.includes("pnpm/action-setup@v5"), `${name} uses pnpm/action-setup@v5.`);
  }
  check(workflow.includes("submodules: false"), `${name} checkout keeps submodules disabled before the targeted opaline update.`);
  check(workflow.includes("actions/setup-node@v5"), `${name} uses actions/setup-node@v5.`);
  check(workflow.includes("node-version: 24"), `${name} pins Node 24 for shell steps.`);
  check(workflow.includes("git submodule update --init --depth=1 opaline"), `${name} initializes only the opaline submodule.`);
}
check(ciWorkflow.includes("actions/cache@v5"), "CI uses actions/cache@v5.");
check(releaseWorkflow.includes("actions/cache@v5"), "Release uses actions/cache@v5.");
check(releaseWorkflow.includes("actions/upload-artifact@v5"), "Release uses actions/upload-artifact@v5.");
check(releaseWorkflow.includes("actions/download-artifact@v5"), "Release uses actions/download-artifact@v5.");
check(releaseWorkflow.includes("node scripts/release/preflight.mjs"), "Release workflow runs the no-build preflight before packaging.");
check(releaseWorkflow.includes("node scripts/release/publish-gh.mjs"), "Release workflow delegates GitHub publishing to the idempotent publish script.");
check(releaseWorkflow.includes("shell: bash"), "Release package step explicitly uses bash for cross-platform shell steps.");

// --- Tauri release workflow -----------------------------------------------
check(releaseWorkflow.includes("dtolnay/rust-toolchain"), "Release installs a Rust toolchain for the Tauri build.");
check(releaseWorkflow.includes("pnpm tauri build"), "Release packages the desktop app with `pnpm tauri build`.");
check(releaseWorkflow.includes("libwebkit2gtk-4.1-dev"), "Release installs the Linux WebKitGTK dependency Tauri needs.");
check(releaseWorkflow.includes("target/release/bundle"), "Release uploads artifacts from the Tauri bundle directory.");
check(!releaseWorkflow.includes("electron-builder"), "Release no longer invokes electron-builder.");

check(publishScript.includes("--clobber"), "GitHub release publisher uploads assets with --clobber.");
check(!/gh release create "\\$TAG" \\$FILES/.test(releaseWorkflow), "Release workflow does not upload assets through gh release create.");

if (failures.length > 0) {
  console.error("Release preflight failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Release preflight passed.");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function exists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}
