/**
 * Generates the phone app's icons from src/assets/brand/songsta-icon.svg:
 *   mobile/assets/icon.png                    — full-bleed square, the tile's colour edge to edge
 *   mobile/assets/android-icon-foreground.png — the white mark alone, at Android's adaptive scale
 *   mobile/assets/android-icon-monochrome.png — the same mark for themed icons (only its alpha counts)
 * The launcher shows 72 of an adaptive icon's 108 dp, so the mark sits smaller
 * on that canvas and comes out the size it has on the tile.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "mobile", "assets");
const svg = readFileSync(join(root, "src", "assets", "brand", "songsta-icon.svg"), "utf8");

const [tile, ...mark] = svg.match(/<path [^>]*>/g);
const tileColor = /fill="([^"]+)"/.exec(tile)[1];
const TILE = 368.599;
const SIZE = 1024;
const ADAPTIVE_CANVAS = (TILE * 108) / 72;

function render(file, viewSize, background) {
  const at = (TILE - viewSize) / 2;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${at} ${at} ${viewSize} ${viewSize}">
    ${background ? `<rect x="${at}" y="${at}" width="${viewSize}" height="${viewSize}" fill="${background}"/>` : ""}
    ${mark.join("")}
  </svg>`;
  const png = new Resvg(doc, { fitTo: { mode: "width", value: SIZE }, font: { loadSystemFonts: false } }).render().asPng();
  writeFileSync(join(assets, file), png);
}

render("icon.png", TILE, tileColor);
render("android-icon-foreground.png", ADAPTIVE_CANVAS, null);
render("android-icon-monochrome.png", ADAPTIVE_CANVAS, null);
console.log(`Wrote mobile/assets: icon.png, android-icon-foreground.png, android-icon-monochrome.png (tile colour ${tileColor})`);
