// Platform adapter — lets main.js stay platform-agnostic.
//
// Browser/PWA: <input type="file"> programmatically triggered.
// Tauri: native dialog via @tauri-apps/plugin-dialog, file bytes via plugin-fs.
//
// `pickFile()` returns a File-like { name, size, arrayBuffer() } or null.
// Tauri imports are dynamic so they're only evaluated when isTauri is true,
// keeping them out of the browser/PWA bundle.

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Touch device (tablet/phone): no hover, coarse pointer. Gates touch-only JS
// behaviors (tap-to-lookup, swipe); CSS uses the same media query directly.
export const isTouch =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ||
    "ontouchstart" in window);

const ACCEPT_DEFAULT = ".pdf,.epub";

export async function pickFile({ accept = ACCEPT_DEFAULT } = {}) {
  if (isTauri) return tauriPickFile();
  return browserPickFile(accept);
}

function browserPickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

async function tauriPickFile() {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({
    multiple: false,
    filters: [{ name: "Books", extensions: ["pdf", "epub"] }],
  });
  if (!path || typeof path !== "string") return null;

  const bytes = await readFile(path);
  const name = path.split(/[/\\]/).pop() || "untitled";
  // Tauri's readFile returns a Uint8Array — wrap it so callers can stay on
  // the standard File-like surface (.arrayBuffer()).
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
