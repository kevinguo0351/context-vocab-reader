// Render a PDF into the container as canvas + text-layer pairs, ONE page at a
// time, lazily. We lay out correctly-sized placeholder .pdf-page divs for every
// page up front (so scroll height is right), then render each page's canvas +
// text layer only when it nears the viewport (IntersectionObserver). On a
// tablet this means a 200-page PDF opens instantly and never holds 200 canvases
// in memory. Batch marking / lookup work on any page that has been rendered
// (i.e. is or was on screen) — which is exactly the page the user can interact
// with.

const SCALE_MIN = 0.75;
const SCALE_MAX = 2.0;
const SIDE_PADDING = 32; // #reader-main left+right padding
const NEAR_VIEWPORT = "150% 0px"; // pre-render pages within ~1.5 screens

// pdf.js 5.7 uses the proposed Map upsert API, which is not available in
// current stable Chromium/Edge releases. Keep the compatibility shim local to
// the PDF path so the rest of the app does not depend on a global polyfill.
function ensureMapUpsertSupport() {
  if (typeof Map.prototype.getOrInsertComputed === "function") return;
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

// Fit the page to the container width (tablet portrait/landscape) instead of a
// fixed scale that overflowed narrow viewports. The canvas backing store is
// multiplied by devicePixelRatio separately for crispness.
function fitScale(unscaledWidth, container) {
  const avail = (container.clientWidth || unscaledWidth) - SIDE_PADDING;
  const fit = avail / unscaledWidth;
  return Math.min(Math.max(fit, SCALE_MIN), SCALE_MAX);
}

export async function renderPdf(pdfjsLib, arrayBuffer, container, onProgress) {
  ensureMapUpsertSupport();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  // Use page 1 to pick a scale + placeholder size (PDFs are almost always
  // uniform; per-page size is corrected when the page actually renders).
  const page1 = await pdf.getPage(1);
  const scale = fitScale(page1.getViewport({ scale: 1 }).width, container);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const base = page1.getViewport({ scale });

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const pageDiv = entry.target;
        observer.unobserve(pageDiv);
        renderOnePage(pdfjsLib, pdf, Number(pageDiv.dataset.pageNumber), pageDiv, scale, dpr)
          .catch((err) => showPageError(pageDiv, err));
      }
    },
    { root: null, rootMargin: NEAR_VIEWPORT },
  );

  for (let i = 1; i <= pdf.numPages; i++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "pdf-page";
    pageDiv.dataset.pageNumber = String(i);
    pageDiv.style.width = `${base.width}px`;
    pageDiv.style.height = `${base.height}px`;
    container.appendChild(pageDiv);
    if (i > 1) observer.observe(pageDiv);
    onProgress?.(i, pdf.numPages);
  }

  // Render page 1 eagerly and propagate its error to loadFile(). Previously
  // every page rendered in a detached async callback, so the app reported a
  // successful load even when the first page failed and remained blank.
  const firstPageDiv = container.querySelector('.pdf-page[data-page-number="1"]');
  await renderOnePage(pdfjsLib, pdf, 1, firstPageDiv, scale, dpr);
}

async function renderOnePage(pdfjsLib, pdf, pageNumber, pageDiv, scale, dpr) {
  if (pageDiv.dataset.rendered) return;
  pageDiv.dataset.rendered = "1";

  const page = await pdf.getPage(pageNumber);
  const cssViewport = page.getViewport({ scale }); // layout (CSS px)
  const renderViewport = page.getViewport({ scale: scale * dpr }); // canvas backing store

  // Correct the placeholder to this page's real size (pages may differ).
  pageDiv.style.width = `${cssViewport.width}px`;
  pageDiv.style.height = `${cssViewport.height}px`;

  // Canvas — backing store at scale×dpr for crispness, displayed at CSS size.
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(renderViewport.width);
  canvas.height = Math.round(renderViewport.height);
  canvas.style.width = `${cssViewport.width}px`;
  canvas.style.height = `${cssViewport.height}px`;
  pageDiv.appendChild(canvas);

  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport: renderViewport,
  }).promise;

  // Text layer — invisible overlay that holds selectable text. pdf.js v5 writes
  // each span's size/scale as inline custom props (--font-height, --scale-x) and
  // computes font-size/transform in CSS from --total-scale-factor. It MUST equal
  // the CSS scale (NOT ×dpr) — the text layer lives in CSS px over the css-sized
  // canvas; style.css mirrors pdf_viewer.css's span rule. Keeping this = scale
  // keeps selection AND batch mark overlays aligned to the glyphs.
  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.dataset.pageNumber = String(pageNumber);
  textLayerDiv.style.setProperty("--total-scale-factor", String(scale));
  pageDiv.appendChild(textLayerDiv);

  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport: cssViewport,
  });
  await textLayer.render();
}

function showPageError(pageDiv, error) {
  console.error("pdf page render failed", error);
  pageDiv.dataset.rendered = "";
  pageDiv.replaceChildren();

  const message = document.createElement("p");
  message.className = "pdf-page-error";
  message.textContent = `此页加载失败：${error?.message || "未知错误"}`;
  pageDiv.appendChild(message);
}
