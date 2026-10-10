/**
 * Génère les icônes PNG de la PWA à partir de public/icons/icon.svg
 * (et icon-maskable.svg, pleine page, pour les icônes que l'OS masque lui-même).
 * Usage : `pnpm add -D sharp && node scripts/generate-icons.mjs`
 * (sharp n'est requis que pour cette étape, pas au runtime.)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "public", "icons");

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("⚠️  sharp non installé. Lance : pnpm add -D sharp");
    process.exit(1);
  }

  const svg = await readFile(join(iconsDir, "icon.svg"));
  const maskable = await readFile(join(iconsDir, "icon-maskable.svg"));
  await mkdir(iconsDir, { recursive: true });

  const targets = [
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "maskable-512.png", size: 512, source: maskable },
    { name: "apple-touch-icon.png", size: 180, source: maskable },
  ];

  for (const { name, size, source = svg } of targets) {
    const png = await sharp(source, { density: 300 }).resize(size, size).png().toBuffer();
    await writeFile(join(iconsDir, name), png);
    console.log(`✓ ${name} (${size}px)`);
  }
  console.log("Icônes générées.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
