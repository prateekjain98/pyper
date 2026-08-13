#!/usr/bin/env node
// Single source of truth for the Pyper brand icon:
//   src/assets/pyper.icon/Assets/ICON.png   (the full-bleed 3D orb —
//   also the macOS Icon Composer source compiled by compile-macos-icon.js)
//
// This regenerates EVERY derived icon from that one source, with the brand's
// rounded-rect shape, so the mark is identical across the desktop app
// (macOS .icns / Windows .ico / Linux + in-app .png) and the marketing-site
// favicon. To swap the brand icon later: replace ICON.png and re-run
//   node scripts/gen-icons.js
//
// Uses `sharp` (a desktop dependency) and, on macOS, `iconutil` for .icns.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const sharp = require("sharp");

const REPO = path.join(__dirname, "..", "..", "..");
const ASSETS = path.join(__dirname, "..", "src", "assets");
const WEB_APP = path.join(__dirname, "..", "..", "web", "app");
const SOURCE = path.join(ASSETS, "pyper.icon", "Assets", "ICON.png");

if (!fs.existsSync(SOURCE)) {
  console.error(`gen-icons: source image not found: ${SOURCE}`);
  process.exit(1);
}

const rel = (p) => path.relative(REPO, p);

// Apple-style rounded-rect (rx = 0.2236 * size — matches logo.svg's 229/1024).
const CORNER = 0.2236;
const roundedTile = (size) =>
  sharp(SOURCE)
    .resize(size, size, { fit: "cover" })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(
            size * CORNER
          )}" ry="${Math.round(size * CORNER)}"/></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png();

async function writePng(size, dest) {
  await roundedTile(size).toFile(dest);
  console.log(`  ${rel(dest)} (${size}px)`);
}

// Minimal ICO writer that embeds PNG frames (Vista+ .ico — 32-bit alpha).
async function writeIco(sizes, dest) {
  const frames = await Promise.all(sizes.map((s) => roundedTile(s).toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + dir.length;
  frames.forEach((buf, i) => {
    const s = sizes[i];
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 0); // width (0 => 256)
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1); // height
    dir.writeUInt16LE(1, i * 16 + 4); // color planes
    dir.writeUInt16LE(32, i * 16 + 6); // bits per pixel
    dir.writeUInt32LE(buf.length, i * 16 + 8); // size of PNG data
    dir.writeUInt32LE(offset, i * 16 + 12); // offset of PNG data
    offset += buf.length;
  });
  fs.writeFileSync(dest, Buffer.concat([header, dir, ...frames]));
  console.log(`  ${rel(dest)} (${sizes.join("/")})`);
}

// macOS .icns via iconutil (legacy fallback for macOS < 26; 26+ uses Assets.car).
async function writeIcns(dest) {
  if (process.platform !== "darwin") {
    console.log("  (skip icon.icns — iconutil is macOS-only)");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pyper-iconset-"));
  const iconset = path.join(tmp, "pyper.iconset");
  fs.mkdirSync(iconset);
  const specs = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [s, name] of specs) await roundedTile(s).toFile(path.join(iconset, name));
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", dest]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`  ${rel(dest)}`);
}

(async () => {
  console.log(`gen-icons: source = ${rel(SOURCE)}\n[desktop]`);
  await writePng(512, path.join(ASSETS, "icon.png")); // in-app logo + Linux app icon
  await writeIco([16, 32, 48, 64, 128, 256], path.join(ASSETS, "icon.ico")); // Windows
  await writeIcns(path.join(ASSETS, "icon.icns")); // macOS legacy fallback

  console.log("[marketing site]");
  fs.mkdirSync(WEB_APP, { recursive: true });
  await writePng(512, path.join(WEB_APP, "icon.png")); // favicon (Next.js auto <link rel=icon>)
  await writePng(180, path.join(WEB_APP, "apple-icon.png")); // apple touch icon
  await writeIco([16, 32, 48], path.join(WEB_APP, "favicon.ico")); // classic /favicon.ico

  console.log("gen-icons: done — every icon derived from the single source.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
