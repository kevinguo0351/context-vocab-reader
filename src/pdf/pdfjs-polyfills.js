// pdfjs-dist 5.7 calls several very-new TC39 builtins unconditionally, with no
// feature detection and no fallback. Chrome 151 (V8 15.1) ships all of them;
// **Edge 140 (V8 14.0) ships none of them** — and there a PDF opens to a
// correctly-sized but completely blank page, with a status bar that says the
// document loaded fine. This module fills exactly the gaps pdfjs actually
// reaches for, nothing more.
//
// Measured on Edge 140 vs Chrome 151 (V8 14.0 vs 15.1), missing on Edge:
//   Math.sumPrecise                      ← the one that blanks the page
//   Map.prototype.getOrInsert{,Computed}
//   WeakMap.prototype.getOrInsert{,Computed}
//
// Why blank rather than an error: `Math.sumPrecise` is called from pdf.js's
// **font rebuilding** path (pdf.worker `TrueTypeTableBuilder` glyph `getSize()`
// and the `name` table's `exactLength`). pdf.js repacks every embedded font
// into a valid TrueType/OpenType before handing it to `FontFace`. A throw in
// there fails that font's load, pdf.js logs it as a *warning* and carries on,
// and every glyph drawn with that font paints nothing. Canvas, page count and
// text layer are all still correct — which is why this reads as "the PDF
// loaded, there's just nothing on it".
//
// Installed in BOTH realms — a patched prototype does not cross the worker
// boundary, so worker-entry.js imports this again on the worker side:
//   main thread — page.render() -> getOptionalContentConfig()
//                 -> WorkerTransport#cacheSimpleMethod()  (Map upsert)
//                 -> font measuring                       (sumPrecise)
//   worker      — font rebuild, XFA layout, annotation save
//
// Kept deliberately narrow: only the members pdfjs-dist calls (verified by
// grepping build/pdf.mjs + build/pdf.worker.mjs), to keep the footprint on
// builtin prototypes as small as possible. `getOrInsert` (the non-Computed
// sibling) is included because it is the same proposal and one line, and a
// pdfjs patch release is free to start using it.

// --- Map/WeakMap upsert ------------------------------------------------------
// https://github.com/tc39/proposal-upsert
// Receivers observed in 5.7: Map (main thread + worker) and one WeakMap
// (`somCache`, the XFA SOM-expression cache) — hence both prototypes.
function installUpsert(Ctor) {
  const proto = Ctor.prototype;
  if (typeof proto.getOrInsertComputed !== "function") {
    Object.defineProperty(proto, "getOrInsertComputed", {
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
  if (typeof proto.getOrInsert !== "function") {
    Object.defineProperty(proto, "getOrInsert", {
      configurable: true,
      writable: true,
      value(key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

installUpsert(Map);
installUpsert(WeakMap);

// --- Math.sumPrecise --------------------------------------------------------
// https://github.com/tc39/proposal-math-sum
//
// The spec requires a *correctly rounded* exact sum. This uses Kahan-Babuska-
// Neumaier compensated summation instead: not bit-identical to the spec in
// adversarial float cases, but exact for what pdfjs feeds it (sums of glyph
// byte-sizes, table lengths and column widths — small integers and simple
// fractions), and dramatically better than a naive reduce.
//
// Known deviation: an all-negative-zero input returns +0 where the spec says
// -0. Nothing in pdfjs can observe that.
if (typeof Math.sumPrecise !== "function") {
  Object.defineProperty(Math, "sumPrecise", {
    configurable: true,
    writable: true,
    value(items) {
      if (items === null || items === undefined) {
        throw new TypeError("Math.sumPrecise called on null or undefined");
      }

      let sum = 0;
      let compensation = 0;
      let count = 0;
      let sawNaN = false;
      let sawPosInf = false;
      let sawNegInf = false;

      for (const item of items) {
        // The spec does NOT coerce — non-Numbers are a TypeError.
        if (typeof item !== "number") {
          throw new TypeError("Math.sumPrecise: every value must be a Number");
        }
        count++;

        if (Number.isNaN(item)) { sawNaN = true; continue; }
        if (item === Infinity) { sawPosInf = true; continue; }
        if (item === -Infinity) { sawNegInf = true; continue; }

        // Neumaier: accumulate the rounding error lost by `sum + item`,
        // whichever operand is larger.
        const t = sum + item;
        compensation += Math.abs(sum) >= Math.abs(item)
          ? (sum - t) + item
          : (item - t) + sum;
        sum = t;
      }

      if (sawNaN || (sawPosInf && sawNegInf)) return NaN;
      if (sawPosInf) return Infinity;
      if (sawNegInf) return -Infinity;
      if (count === 0) return -0; // spec: empty sum is -0

      return sum + compensation;
    },
  });
}
