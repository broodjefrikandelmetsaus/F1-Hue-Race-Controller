import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(".");
const source = resolve(root, "assets/f1-hue-logo.svg");
const androidRes = resolve(root, "android/app/src/main/res");
const densities = { "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192 };

for (const [folder, size] of Object.entries(densities)) {
  const dir = resolve(androidRes, folder);
  await mkdir(dir, { recursive: true });
  const png = await sharp(source).resize(size, size, { fit: "contain" }).png().toBuffer();
  await sharp(png).toFile(resolve(dir, "ic_launcher.png"));
  await sharp(png).toFile(resolve(dir, "ic_launcher_round.png"));
}
console.log("F1 Hue launcher icons generated for all Android densities.");
