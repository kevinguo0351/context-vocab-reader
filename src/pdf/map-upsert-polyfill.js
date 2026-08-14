// Map upsert (`getOrInsertComputed`) is a TC39 proposal that pdfjs-dist 5.7
// calls unconditionally. Chrome 151 ships it; **Edge 140 does not** — and there
// every page render throws "getOrInsertComputed is not a function", which the
// reader used to surface as a fully white page with a normal-looking status bar.
//
// It is reached from two separate realms, so this module is imported for its
// side effect from both:
//   main thread — page.render() -> getOptionalContentConfig()
//                 -> WorkerTransport#cacheSimpleMethod()
//   worker      — XFA / AcroForm / annotation-save paths
// A patched Map.prototype does NOT cross the worker boundary, which is why
// worker-entry.js has to install it again on the worker side.
//
// Deliberately only `getOrInsertComputed` — the sole member of the proposal
// pdfjs-dist actually calls — to keep the footprint on a builtin prototype
// as small as possible.

if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    configurable: true,
    writable: true,
    value(key, callback) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}
