/**
 * Build Windows/macOS icons from public/favicon.svg (BorsMark).
 * Output: resources/icon.png (512), resources/icon.ico (multi-size).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import toIco from "to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = path.join(root, "public", "favicon.svg");
const outDir = path.join(root, "resources");

if (!fs.existsSync(svgPath)) {
  console.error("Missing", svgPath);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);
fs.mkdirSync(outDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  icoSizes.map((size) => sharp(svg).resize(size, size).png().toBuffer())
);

await sharp(svg).resize(512, 512).png().toFile(path.join(outDir, "icon.png"));
fs.writeFileSync(path.join(outDir, "icon.ico"), await toIco(pngBuffers));
await sharp(svg)
  .resize(180, 180)
  .png()
  .toFile(path.join(root, "public", "apple-touch-icon.png"));

console.log("Wrote resources/icon.png, resources/icon.ico, public/apple-touch-icon.png");
