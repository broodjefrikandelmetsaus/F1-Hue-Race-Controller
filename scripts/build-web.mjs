import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".");
const output = resolve(root, "www");
const requiredFiles = ["index.html", "app.js", "styles.css"];
const optionalFiles = ["manifest.json", "sw.js"];

await mkdir(output, { recursive: true });
await mkdir(resolve(output, "assets"), { recursive: true });
for (const file of requiredFiles) {
  await copyFile(resolve(root, file), resolve(output, file));
}
for (const file of optionalFiles) {
  try { await copyFile(resolve(root, file), resolve(output, file)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
await copyFile(resolve(root, "assets/f1-hue-logo.svg"), resolve(output, "assets/f1-hue-logo.svg"));
console.log("Webbestanden en F1 Hue-logo klaargezet voor Capacitor in ./www");
