import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];

const packageJson = readJson("package.json");
const appPackageJson = readJson("app/package.json");
const builderConfig = read("app/electron-builder.yml");
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
  "Vite renderer build uses relative asset URLs so Electron loadFile can load packaged assets."
);
check(
  copyCss.includes("dirname(dirname(fileURLToPath(import.meta.url)))") && !copyCss.includes(".replace(/\\/scripts$/"),
  "Opaline CSS copy script derives packageRoot with platform-safe path helpers."
);

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
check(releaseWorkflow.includes("shell: bash"), "Release package step explicitly uses bash for cross-platform shell cleanup.");
check(
  releaseWorkflow.includes('if [ -z "$CSC_LINK" ]; then unset CSC_LINK CSC_KEY_PASSWORD; fi') &&
    releaseWorkflow.includes('if [ -z "$APPLE_ID" ]; then unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; fi'),
  "Release package step unsets empty macOS signing secrets before invoking electron-builder."
);

const topArtifactName = getScalar(builderConfig, "artifactName");
const nsisArtifactName = getSectionScalar(builderConfig, "nsis", "artifactName");
const portableArtifactName = getSectionScalar(builderConfig, "portable", "artifactName");
check(Boolean(nsisArtifactName), "electron-builder config gives NSIS a target-specific artifactName.");
check(Boolean(portableArtifactName), "electron-builder config gives portable Windows builds a target-specific artifactName.");
check(nsisArtifactName !== portableArtifactName, "NSIS and portable Windows artifacts cannot resolve to the same .exe asset name.");
checkUniquePlannedArtifacts({ topArtifactName, nsisArtifactName, portableArtifactName });

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

function getScalar(source, key) {
  const match = source.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function getSectionScalar(source, section, key) {
  const lines = source.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    if (!line.startsWith(" ") && line.endsWith(":")) {
      inSection = line.slice(0, -1) === section;
      continue;
    }
    if (inSection) {
      const match = line.match(new RegExp(`^\\s{2}${escapeRegExp(key)}:\\s*(.+)$`));
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

function checkUniquePlannedArtifacts({ topArtifactName, nsisArtifactName, portableArtifactName }) {
  const version = packageJson.version;
  const planned = [
    ["mac-dmg", topArtifactName, { version, os: "mac", arch: "arm64", ext: "dmg" }],
    ["mac-zip", topArtifactName, { version, os: "mac", arch: "arm64", ext: "zip" }],
    ["win-nsis", nsisArtifactName, { version, os: "win", arch: "x64", ext: "exe" }],
    ["win-portable", portableArtifactName, { version, os: "win", arch: "x64", ext: "exe" }],
    ["win-zip", topArtifactName, { version, os: "win", arch: "x64", ext: "zip" }],
    ["linux-AppImage", topArtifactName, { version, os: "linux", arch: "x64", ext: "AppImage" }],
    ["linux-deb", topArtifactName, { version, os: "linux", arch: "x64", ext: "deb" }],
    ["linux-tar.gz", topArtifactName, { version, os: "linux", arch: "x64", ext: "tar.gz" }],
  ];
  const seen = new Map();
  for (const [label, pattern, values] of planned) {
    if (!pattern) {
      continue;
    }
    const name = expandArtifactPattern(pattern, values);
    const previous = seen.get(name);
    check(!previous, `Planned release asset name "${name}" is shared by ${previous ?? "unknown"} and ${label}.`);
    seen.set(name, label);
  }
}

function expandArtifactPattern(pattern, values) {
  return pattern.replace(/\${([_a-zA-Z./*+]+)}/g, (match, key) => {
    if (key in values) {
      return values[key];
    }
    if (key === "productName" || key === "name") {
      return "Construct";
    }
    failures.push(`Unsupported artifactName macro ${match} in "${pattern}".`);
    return match;
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
