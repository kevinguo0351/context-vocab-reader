// EPUB rendering via epubjs. Returns the rendition so callers can wire
// selection events (rendition.on('selected', ...)) — that's the cleanest hook
// because epubjs already gives us the CFI range and the iframe's Contents
// object, no need to chase mouse events through the sandbox.

import ePub from "epubjs";
import { setupReadingControls } from "./reading.js";

export async function renderEpub(arrayBuffer, container, { startCfi } = {}) {
  const viewer = document.createElement("div");
  viewer.className = "epub-viewer";
  container.appendChild(viewer);

  const nav = document.createElement("div");
  nav.className = "epub-nav";
  nav.innerHTML = `
    <button class="epub-nav-btn" data-dir="prev" type="button">‹ 上一页</button>
    <span class="epub-nav-loc"></span>
    <button class="epub-nav-btn" data-dir="next" type="button">下一页 ›</button>
  `;
  container.appendChild(nav);

  // Two-page spread in landscape on a wide screen; single page in portrait.
  const spreadFor = () =>
    window.matchMedia("(orientation: landscape)").matches && window.innerWidth >= 800
      ? "auto"
      : "none";

  const book = ePub(arrayBuffer);
  const rendition = book.renderTo(viewer, {
    width: "100%",
    height: "100%",
    flow: "paginated",
    spread: spreadFor(),
    allowScriptedContent: false,
  });

  // Re-paginate when the tablet is rotated.
  const orientMq = window.matchMedia("(orientation: landscape)");
  orientMq.addEventListener?.("change", () => rendition.spread(spreadFor()));

  await rendition.display(startCfi || undefined);

  // epubjs measures the container at display() time; if the flex layout hasn't
  // settled yet it renders the chapter iframe at 0 height → book loads but
  // nothing is visible. A ResizeObserver re-syncs the rendition to the viewer's
  // real size — fixes that initial 0-height race AND tablet rotation. Guard
  // against a resize loop by only acting when the size actually changed.
  let lastW = 0;
  let lastH = 0;
  const ro = new ResizeObserver(() => {
    const r = viewer.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w > 0 && h > 0 && (w !== lastW || h !== lastH)) {
      lastW = w;
      lastH = h;
      rendition.resize(w, h);
    }
  });
  ro.observe(viewer);

  // Reading comfort: font size / line height / theme (persisted).
  setupReadingControls(rendition, viewer, nav);

  nav.querySelector('[data-dir="prev"]').addEventListener("click", () => rendition.prev());
  nav.querySelector('[data-dir="next"]').addEventListener("click", () => rendition.next());

  // Keyboard nav at the document level — reading with arrow keys is the
  // expected default; epubjs doesn't bind these itself.
  const onKey = (e) => {
    if (e.key === "ArrowLeft") rendition.prev();
    else if (e.key === "ArrowRight") rendition.next();
  };
  document.addEventListener("keydown", onKey);
  rendition.on("keyup", onKey);

  rendition.on("relocated", (loc) => {
    const span = nav.querySelector(".epub-nav-loc");
    if (loc?.start?.displayed) {
      span.textContent = `${loc.start.displayed.page}/${loc.start.displayed.total}`;
    }
  });

  return { book, rendition };
}
