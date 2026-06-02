// Render a PDF document into the container as canvas + text-layer pairs per page.
// Text layer is what enables window.getSelection() to return real text from PDFs.

const SCALE_MIN = 0.75;
const SCALE_MAX = 2.0;
const SIDE_PADDING = 32; // #reader-main left+right padding

// Fit the page to the container width (tablet portrait/landscape) instead of a
// fixed 1.5× that overflowed narrow viewports. Clamped so tiny/huge pages stay
// sane. This is the CSS-pixel scale; the canvas backing store is multiplied by
// devicePixelRatio separately for crispness.
function fitScale(page, container) {
  const unscaled = page.getViewport({ scale: 1 });
  const avail = (container.clientWidth || unscaled.width) - SIDE_PADDING;
  const fit = avail / unscaled.width;
  return Math.min(Math.max(fit, SCALE_MIN), SCALE_MAX);
}

export async function renderPdf(pdfjsLib, arrayBuffer, container, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i, pdf.numPages);
    await renderOnePage(pdfjsLib, pdf, i, container);
  }
}

async function renderOnePage(pdfjsLib, pdf, pageNumber, container) {
  const page = await pdf.getPage(pageNumber);
  const scale = fitScale(page, container);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssViewport = page.getViewport({ scale });          // layout (CSS px)
  const renderViewport = page.getViewport({ scale: scale * dpr }); // canvas backing store

  const pageDiv = document.createElement("div");
  pageDiv.className = "pdf-page";
  pageDiv.dataset.pageNumber = String(pageNumber);
  pageDiv.style.width = `${cssViewport.width}px`;
  pageDiv.style.height = `${cssViewport.height}px`;
  container.appendChild(pageDiv);

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

  // Text layer — invisible overlay that holds selectable text.
  // pdf.js v5 writes each span's size/scale as inline custom properties
  // (--font-height, --scale-x) and computes the real font-size/transform in CSS
  // from --total-scale-factor. It MUST equal the CSS scale (NOT ×dpr) — the text
  // layer lives in CSS px over the css-sized canvas; style.css mirrors
  // pdf_viewer.css's span rule. Keeping this = scale keeps selection AND batch
  // mark overlays aligned to the glyphs.
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
