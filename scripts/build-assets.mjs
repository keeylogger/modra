#!/usr/bin/env node
/**
 * Generate raster assets (PNG, JPG, ICO) from the master SVG sources.
 *
 *   npm run assets
 *
 * Inputs (under ./assets):
 *   - logo.svg            full square logo with off-white card background
 *   - logo-transparent.svg same logo with a transparent background
 *   - logomark.svg        just the red M
 *   - favicon.svg         compact rounded brand square (used for favicons)
 *   - wordmark.svg        logo + "modra" wordmark
 *   - og-image.svg        1200x630 social preview card
 *
 * Outputs are written next to the SVGs (./assets) and to ./docs as needed.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const A = (p) => resolve(root, "assets", p);
const D = (p) => resolve(root, "docs", p);

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function svgToPng(svgPath, outPath, { width, height, background }) {
  const svg = await readFile(svgPath);
  let pipe = sharp(svg, { density: 384 }).resize({ width, height, fit: "contain", background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) pipe = pipe.flatten({ background });
  const buf = await pipe.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outPath, buf);
  console.log(`  ${outPath.replace(root + "\\", "").replace(root + "/", "")}  (${width}x${height ?? width})`);
  return buf;
}

async function svgToJpg(svgPath, outPath, { width, height, background }) {
  const svg = await readFile(svgPath);
  const buf = await sharp(svg, { density: 384 })
    .resize({ width, height, fit: "contain", background })
    .flatten({ background: background ?? { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  await writeFile(outPath, buf);
  console.log(`  ${outPath.replace(root + "\\", "").replace(root + "/", "")}  (${width}x${height ?? width}, jpg)`);
}

async function main() {
  await ensure(A("png"));
  await ensure(D("img"));

  console.log("» Generating square logo PNGs (transparent background)…");
  for (const size of [128, 256, 512, 1024]) {
    await svgToPng(A("logo-transparent.svg"), A(`png/logo-${size}.png`), { width: size, height: size });
  }

  console.log("» Generating square logo PNGs (off-white card background)…");
  for (const size of [256, 512, 1024]) {
    await svgToPng(A("logo.svg"), A(`png/logo-card-${size}.png`), { width: size, height: size });
  }

  console.log("» Generating logomark PNGs (just the M)…");
  for (const size of [64, 128, 256, 512]) {
    await svgToPng(A("logomark.svg"), A(`png/logomark-${size}.png`), { width: size, height: size });
  }

  console.log("» Generating favicon PNGs…");
  const faviconBuffers = [];
  for (const size of [16, 32, 48, 64, 128, 180, 192, 512]) {
    const buf = await svgToPng(A("favicon.svg"), A(`png/favicon-${size}.png`), { width: size, height: size });
    if ([16, 32, 48].includes(size)) faviconBuffers.push(buf);
  }
  // Apple touch icon
  await svgToPng(A("favicon.svg"), D("apple-touch-icon.png"), { width: 180, height: 180 });
  // Android / general high-res favicon
  await svgToPng(A("favicon.svg"), D("favicon-512.png"), { width: 512, height: 512 });

  console.log("» Generating multi-resolution favicon.ico (16, 32, 48)…");
  const ico = await pngToIco(faviconBuffers);
  await writeFile(D("favicon.ico"), ico);
  console.log(`  docs/favicon.ico  (16/32/48 multi-res)`);
  // Also publish a copy at repo root, since GitHub Pages serves it from /.
  await writeFile(resolve(root, "favicon.ico"), ico);
  console.log(`  favicon.ico (root mirror)`);

  console.log("» Generating wordmark PNGs…");
  await svgToPng(A("wordmark.svg"), A("png/wordmark-1280.png"), { width: 1280, height: 320 });
  await svgToPng(A("wordmark.svg"), A("png/wordmark-2560.png"), { width: 2560, height: 640 });

  console.log("» Generating OG image (PNG + JPG)…");
  await svgToPng(A("og-image.svg"), A("png/og-image.png"), { width: 1200, height: 630 });
  await svgToJpg(A("og-image.svg"), A("png/og-image.jpg"), { width: 1200, height: 630, background: { r: 15, g: 22, b: 20 } });
  // Mirror to docs/ so README.html can link to it
  await svgToPng(A("og-image.svg"), D("og-image.png"), { width: 1200, height: 630 });

  console.log("» Copying primary brand SVGs into docs/…");
  for (const name of ["logo.svg", "logo-transparent.svg", "logomark.svg", "favicon.svg", "wordmark.svg", "og-image.svg"]) {
    await writeFile(D(name), await readFile(A(name)));
    console.log(`  docs/${name}`);
  }

  console.log("\n✓ assets generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
