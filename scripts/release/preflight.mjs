import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The parts of the release pipeline that cannot be checked by building it.
 *
 * Everything here has broken a release at least once, costs nothing to check,
 * and would otherwise only be discovered by a matrix job forty minutes in, or —
 * worse — by whoever downloaded the result. It runs before `pnpm install`, so it
 * may only read files.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

const packageJson = readJson("package.json");
const desktopPackageJson = readJson("apps/desktop/package.json");
const build = desktopPackageJson.build ?? {};
const ciWorkflow = read(".github/workflows/ci.yml");
const releaseWorkflow = read(".github/workflows/release.yml");
const workspace = read("pnpm-workspace.yaml");
const lockfile = read("pnpm-lock.yaml");
const publishScript = read("scripts/release/publish-gh.mjs");

// --- versions -------------------------------------------------------------
check(packageJson.version === desktopPackageJson.version, "Root and desktop package versions stay aligned, since the tag is checked against both.");
check(existsSync(path.join(root, "docs", "releases", `${packageJson.version}.md`)), `docs/releases/${packageJson.version}.md exists — the notes are stamped into the update feed and used as the release body.`);

// --- what a downloaded app talks to ---------------------------------------
// A packaged build cannot default to localhost: whoever downloads Construct is
// not running the API, and every sign-in fails with a refused connection that
// reads as the app being broken.
check(
  typeof desktopPackageJson.constructHostedApiOrigin === "string" && /^https?:\/\//.test(desktopPackageJson.constructHostedApiOrigin),
  "apps/desktop/package.json stamps constructHostedApiOrigin with the deployed API origin."
);

// --- electron-builder configuration ---------------------------------------
check(build.appId === "cc.construct.desktop", "electron-builder keeps the cc.construct.desktop application id, which is what an installed copy updates in place.");
check(build.directories?.output === "dist-release", "electron-builder writes to apps/desktop/dist-release, which is where the workflow looks for installers.");
check(build.publish?.provider === "github", "electron-builder publishes to GitHub, which is the feed electron-updater reads.");
check(targets(build.mac).includes("dmg") && targets(build.mac).includes("zip"), "macOS builds a dmg to download and a zip for the updater, which cannot install from a dmg.");
check(arches(build.mac).includes("arm64") && arches(build.mac).includes("x64"), "macOS builds both architectures, so an Intel Mac is not offered an Apple Silicon app.");
check(targets(build.win).includes("nsis"), "Windows builds an NSIS installer.");
check(targets(build.linux).includes("AppImage") && targets(build.linux).includes("deb"), "Linux builds an AppImage and a deb.");
check(build.mac?.hardenedRuntime === true && typeof build.mac?.entitlements === "string", "macOS uses the hardened runtime with entitlements, without which notarization is refused.");
check(existsSync(path.join(root, "apps/desktop", build.mac?.entitlements ?? "")), "The macOS entitlements file exists at the path the build points to.");
// asar packs node_modules into an archive that dlopen cannot read from.
const unpack = build.asarUnpack ?? [];
check(unpack.some((glob) => glob.includes("node-pty")), "node-pty is unpacked from the asar; the terminal cannot load a native module out of an archive.");
check(unpack.some((glob) => glob.includes("electron-liquid-glass")), "electron-liquid-glass is unpacked from the asar.");
check(
  (build.extraResources ?? []).some((entry) => entry?.to === "runtime-icons"),
  "The runtime icons ship as extra resources; the tray and dock read them from disk at run time."
);
for (const icon of [build.mac?.icon, build.win?.icon, build.linux?.icon]) {
  check(typeof icon === "string" && existsSync(path.join(root, "apps/desktop", icon)), `The packaged icon ${icon} exists.`);
}

// --- scripts the workflows call -------------------------------------------
for (const script of ["build", "verify:build", "rebuild:native", "typecheck", "test"]) {
  check(typeof desktopPackageJson.scripts?.[script] === "string", `apps/desktop exposes the ${script} script the release workflow runs.`);
}
check(existsSync(path.join(root, "apps/desktop/scripts/verify-build.mjs")), "verify-build.mjs exists — it is the gate against shipping a build that opens a blank window.");

// --- the workspace a checkout without submodule access can install --------
check(!/^\s*-\s*private\/\*/m.test(workspace), "pnpm-workspace.yaml leaves the private backend submodule out; no CI checkout can read it, and a frozen install would fail on the missing importer.");
check(!lockfile.includes("private/construct-cloud-backend"), "pnpm-lock.yaml carries no importer for the private submodule.");

// --- workflows -------------------------------------------------------------
for (const [name, workflow] of [
  ["CI", ciWorkflow],
  ["Release", releaseWorkflow],
]) {
  check(workflow.includes("actions/checkout@v4"), `${name} uses actions/checkout@v4.`);
  check(workflow.includes("submodules: false"), `${name} keeps the private submodule out of the checkout.`);
  check(workflow.includes("libsecret-1-dev"), `${name} installs libsecret, which keytar links against.`);
  check(workflow.includes("pnpm install --frozen-lockfile"), `${name} installs from the lockfile.`);
}
check(!releaseWorkflow.includes("tauri"), "The release workflow no longer packages the app with Tauri.");
check(releaseWorkflow.includes("--publish never"), "electron-builder is told not to publish; the publish job owns the release, and a matrix that publishes races itself.");
check(releaseWorkflow.includes("releaseInfo.releaseNotesFile"), "The release notes are stamped into the update feed at package time.");
check(releaseWorkflow.includes("latest-mac.yml") && releaseWorkflow.includes("latest-linux.yml"), "The release verifies the update feed each platform writes.");
check(releaseWorkflow.includes("dist-release/latest*.yml"), "The update feed is uploaded as a release asset; without it no installed copy ever sees the release.");
check(releaseWorkflow.includes("rebuild:native"), "Native modules are rebuilt for Electron's ABI before packaging.");
check(releaseWorkflow.includes("node scripts/release/publish-gh.mjs"), "Publishing goes through the idempotent publish script, so a re-run repairs a release rather than failing on it.");
check(publishScript.includes("--clobber"), "The publisher uploads assets with --clobber, so a re-run replaces an asset instead of erroring.");
check(/latest\(-mac\|-linux\)\?/.test(publishScript), "The publisher uploads the update feed alongside the installers.");

if (failures.length > 0) {
  console.error("Release preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release preflight passed.");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function targets(platform) {
  return (platform?.target ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.target));
}

function arches(platform) {
  return (platform?.target ?? []).flatMap((entry) => (typeof entry === "string" ? [] : (entry?.arch ?? [])));
}

function check(condition, message) {
  if (!condition) failures.push(message);
}
