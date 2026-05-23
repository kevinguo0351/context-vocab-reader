// Render a PDF document into the container as canvas + text-layer pairs per page.
// Text layer is what enables window.getSelection() to return real text from PDFs.

const RENDER_SCALE = 1.5;

export async function renderPdf(pdfjsLib, arrayBuffer, container, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(i, pdf.numPages);
    await renderOnePage(pdfjsLib, pdf, i, container);
  }
}

async function renderOnePage(pdfjsLib, pdf, pageNumber, container) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const pageDiv = document.createElement("div");
  pageDiv.className = "pdf-page";
  pageDiv.dataset.pageNumber = String(pageNumber);
  pageDiv.style.width = `${viewport.width}px`;
  pageDiv.style.height = `${viewport.height}px`;
  container.appendChild(pageDiv);

  // Canvas — visual rendering
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  pageDiv.appendChild(canvas);

  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;

  // Text layer — invisible overlay that holds selectable text
  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.dataset.pageNumber = String(pageNumber);
  pageDiv.appendChild(textLayerDiv);

  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();
}
