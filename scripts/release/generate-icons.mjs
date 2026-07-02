import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = path.join(root, "app", "assets", "icon.png");
const runtimeIcon = path.join(root, "app", "assets", "runtime-icon.png");
const outputDir = path.join(root, "app", "build", "icons");
const pngDir = path.join(outputDir, "png");
const maskTool = path.join(root, "scripts", "release", "mask-macos-icon.swift");
const macOSReferenceApp = "/System/Applications/App Store.app";
const macOSContentBoxScale = 824 / 1024;

if (process.platform !== "darwin") {
  console.log("Skipping icon generation: 'sips' is a macOS-only tool. Using pre-generated icons.");
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512];
const generatedPngs = buildMaskedPngs([...pngSizes, 1024]);
for (const size of pngSizes) {
  copyPng(generatedPngs.get(size), path.join(pngDir, `${size}x${size}.png`));
}

copyPng(generatedPngs.get(512), path.join(outputDir, "icon.png"));
copyPng(generatedPngs.get(1024), path.join(outputDir, "icon-1024.png"));
copyPng(generatedPngs.get(512), runtimeIcon);

writeFileSync(path.join(outputDir, "icon.ico"), buildIco([
  [16, path.join(pngDir, "16x16.png")],
  [24, path.join(pngDir, "24x24.png")],
  [32, path.join(pngDir, "32x32.png")],
  [48, path.join(pngDir, "48x48.png")],
  [64, path.join(pngDir, "64x64.png")],
  [128, path.join(pngDir, "128x128.png")],
  [256, path.join(pngDir, "256x256.png")]
]));
writeFileSync(path.join(outputDir, "icon.icns"), buildIcns([
  ["icp4", path.join(pngDir, "16x16.png")],
  ["icp5", path.join(pngDir, "32x32.png")],
  ["icp6", path.join(pngDir, "64x64.png")],
  ["ic07", path.join(pngDir, "128x128.png")],
  ["ic08", path.join(pngDir, "256x256.png")],
  ["ic09", path.join(pngDir, "512x512.png")],
  ["ic10", path.join(outputDir, "icon-1024.png")]
]));

function copyPng(input, output) {
  writeFileSync(output, input);
}

function buildMaskedPngs(sizes) {
  if (!existsSync(macOSReferenceApp)) {
    throw new Error(`Missing macOS reference app at ${macOSReferenceApp}`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "construct-icons-"));
  try {
    const outputs = new Map();
    for (const size of sizes) {
      const output = path.join(tempDir, `icon-${size}.png`);
      run(
        "swift",
        [maskTool, source, macOSReferenceApp, String(size), String(macOSContentBoxScale), output],
        `apply macOS reference mask at ${size}px`
      );
      outputs.set(size, readFileSync(output));
    }
    return outputs;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function run(command, args, action) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`${command} failed while trying to ${action}`);
  }
}

function buildIco(entries) {
  const images = entries.map(([size, file]) => ({
    size,
    data: readFileSync(file)
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const start = index * 16;
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, start);
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, start + 1);
    directory.writeUInt8(0, start + 2);
    directory.writeUInt8(0, start + 3);
    directory.writeUInt16LE(1, start + 4);
    directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(image.data.length, start + 8);
    directory.writeUInt32LE(offset, start + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

function buildIcns(entries) {
  const chunks = entries.map(([type, file]) => {
    const data = readFileSync(file);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });

  const fileHeader = Buffer.alloc(8);
  fileHeader.write("icns", 0, 4, "ascii");
  fileHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([fileHeader, ...chunks]);
}
