// pdf.js spawns its own worker — `new Worker(workerSrc, { type: "module" })` in
// PDFWorker#initialize — so the main thread cannot reach into the worker's realm
// to patch it. This module is what we hand pdf.js as workerSrc instead of
// pdf.worker.min.mjs directly: it installs the Map upsert polyfill, then loads
// the real worker.
//
// Static imports are evaluated in source order before this module's body runs,
// so the polyfill is in place before pdf.worker's module body executes.

import "./map-upsert-polyfill.js";
import "pdfjs-dist/build/pdf.worker.min.mjs";
