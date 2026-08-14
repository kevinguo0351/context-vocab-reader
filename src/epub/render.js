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
  const orientationQuery = window.matchMedia("(orientation: landscape)");
  const spreadFor = () =>
    orientationQuery.matches && window.innerWidth >= 800
      ? "auto"
      : "none";

  // Let the flex layout settle so the viewer has real pixel dimensions BEFORE
  // epubjs measures it. With height:"100%" in a flex container, epubjs's
  // paginated flow can collapse the chapter iframe to 0 height (the book loads
  // but nothing shows) — passing explicit pixels avoids that.
  await new Promise(requestAnimationFrame);
  const sizeOf = () => {
    const r = viewer.getBoundingClientRect();
    return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
  };

  const book = ePub(arrayBuffer);
  const { width, height } = sizeOf();
  const rendition = book.renderTo(viewer, {
    width,
    height,
    flow: "paginated",
    spread: spreadFor(),
    allowScriptedContent: false,
  });

  await rendition.display(startCfi || undefined);

  // Re-fit on tablet rotation / window resize (and any late layout settle).
  const refit = () => {
    const s = sizeOf();
    rendition.resize(s.width, s.height);
    rendition.spread(spreadFor());
  };
  window.addEventListener("resize", refit);
  orientationQuery.addEventListener?.("change", refit);

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

  const destroy = () => {
    window.removeEventListener("resize", refit);
    orientationQuery.removeEventListener?.("change", refit);
    document.removeEventListener("keydown", onKey);
    rendition.off?.("keyup", onKey);
    book.destroy();
  };

  return { book, rendition, destroy };
}
