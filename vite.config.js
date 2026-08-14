// Vite config — adds PWA so the reader can be installed to home screen on
// iPad / Android tablet without going through Tauri yet, and tunes
// dev-server settings for Tauri (fixed port + no log clearing) when run
// under `tauri dev`.
//
// Icons: SVG (scalable) + PNG 192/512 (Android/maskable) + apple-touch-icon
// 180 (iOS home screen — Safari ignores SVG/manifest icons for the home icon).

import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createRequire } from "node:module";
import { createReadStream, cpSync, existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));

// pdf.js fetches CMap tables (CJK/CID encodings) and the 14 standard font files
// lazily at runtime as separate files. Without them a Chinese PDF logs
// "Ensure that the `cMapUrl` API parameter is provided" and renders those
// glyphs blank. Expose both dirs under /pdfjs/ — via middleware in dev, copied
// into dist on build so GitHub Pages serves them too. They stay out of the
// PWA precache (workbox globPatterns) so the 2.3 MB is fetched on demand only.
function pdfjsRuntimeAssets() {
  const SUBDIRS = ["cmaps", "standard_fonts"];
  return {
    name: "pdfjs-runtime-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/(cmaps|standard_fonts)\/([^?]+)/.exec(req.url || "");
        if (!match) return next();
        // path.normalize + prefix check keeps `..` from escaping the dir.
        const dir = path.join(pdfjsDir, match[1]);
        const file = path.normalize(path.join(dir, match[2]));
        if (!file.startsWith(dir) || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const sub of SUBDIRS) {
        cpSync(path.join(pdfjsDir, sub), path.join("dist", "pdfjs", sub), {
          recursive: true,
        });
      }
    },
  };
}

const tauriHost = process.env.TAURI_DEV_HOST;
// GitHub Pages serves under /<repo>/. The deploy workflow sets BASE_PATH;
// local dev / Tauri stay at "/". Manifest start_url/scope follow base so the
// installed PWA stays scoped to the sub-path.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  // pdf.js loads its worker as an ES module (`new Worker(src, {type:"module"})`),
  // so src/pdf/worker-entry.js must be emitted as one too — the default 'iife'
  // would break its static imports.
  worker: { format: "es" },
  // Tauri pipes its own status output; let it own the terminal during dev.
  clearScreen: false,
  server: {
    // Tauri convention: port 1420, hard-fail if busy so we never drift.
    port: 1420,
    strictPort: true,
    host: tauriHost || false,
    hmr: tauriHost
      ? { protocol: "ws", host: tauriHost, port: 1421 }
      : undefined,
    watch: {
      // The Rust crate has its own watcher in `tauri dev`; ignoring it from
      // Vite avoids cross-watch noise.
      ignored: ["**/src-tauri/**"],
    },
  },
  plugins: [
    pdfjsRuntimeAssets(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Context Vocab Reader",
        short_name: "VocabReader",
        description: "划词查 + 一键存欧陆 · PDF / EPUB 阅读器",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "any",
        id: base,
        start_url: base,
        scope: base,
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // PDF.js worker is large (~2MB); workbox by default warns above 2MiB.
        // Bump the cap so the precache succeeds without surgery.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // `mjs` matters: an earlier build's worker was emitted as
        // `pdf.worker.min-<hash>.mjs`, which this list did NOT match — so the
        // shell (index.html + index-*.js) got precached while the worker it
        // pointed at did not. Once a later deploy deleted that hashed file,
        // anyone holding the old precache was stuck with a durable 404
        // ("Setting up fake worker failed") rather than a one-load race.
        // Keep every emitted code extension here so a precached shell can
        // never reference an uncached, deletable asset.
        globPatterns: ["**/*.{js,mjs,css,html,svg,woff2}"],
      },
    }),
  ],
});
