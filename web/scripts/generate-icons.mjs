import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'icon.svg');
const iconsDir = path.join(publicDir, 'icons');

if (!fs.existsSync(svgPath)) {
  console.error('public/icon.svg not found');
  process.exit(1);
}
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const sizes = [120, 152, 167, 180, 192, 512];
const svg = fs.readFileSync(svgPath);

for (const size of sizes) {
  await sharp(svg).resize(size, size).png().toFile(path.join(iconsDir, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}

console.log('Icons generated in public/icons/');
