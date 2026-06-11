import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const source = path.join(root, "app", "assets", "icon.png");
const outputDir = path.join(root, "app", "build", "icons");
const pngDir = path.join(outputDir, "png");

mkdirSync(outputDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512];
for (const size of pngSizes) {
  resizePng(source, path.join(pngDir, `${size}x${size}.png`), size);
}

resizePng(source, path.join(outputDir, "icon.png"), 512);
resizePng(source, path.join(outputDir, "icon-1024.png"), 1024);

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

function resizePng(input, output, size) {
  const result = spawnSync("sips", ["-z", String(size), String(size), input, "--out", output], {
    stdio: "ignore"
  });
  if (result.status !== 0) {
    throw new Error(`sips failed while resizing ${path.basename(output)} to ${size}px`);
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
