// pdf.js spawns its own worker — `new Worker(workerSrc, { type: "module" })` in
// PDFWorker#initialize — so the main thread cannot reach into the worker's realm
// to patch it. This module is what we hand pdf.js as workerSrc instead of
// pdf.worker.min.mjs directly: it installs the missing-builtin polyfills, then
// loads the real worker.
//
// Static imports are evaluated in source order before this module's body runs,
// so the polyfills are in place before pdf.worker's module body executes.
// This side is the important one: font rebuilding (Math.sumPrecise) happens
// entirely in the worker.

import "./pdfjs-polyfills.js";
import "pdfjs-dist/build/pdf.worker.min.mjs";
