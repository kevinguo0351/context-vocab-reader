// Vite config — adds PWA so the reader can be installed to home screen on
// iPad / Android tablet without going through Tauri yet, and tunes
// dev-server settings for Tauri (fixed port + no log clearing) when run
// under `tauri dev`.
//
// Icons: SVG (scalable) + PNG 192/512 (Android/maskable) + apple-touch-icon
// 180 (iOS home screen — Safari ignores SVG/manifest icons for the home icon).

import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const tauriHost = process.env.TAURI_DEV_HOST;
// GitHub Pages serves under /<repo>/. The deploy workflow sets BASE_PATH;
// local dev / Tauri stay at "/". Manifest start_url/scope follow base so the
// installed PWA stays scoped to the sub-path.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
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
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
      },
    }),
  ],
});
