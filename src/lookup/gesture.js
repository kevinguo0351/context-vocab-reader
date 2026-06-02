// Touch gesture classifier for the reader surface. Bound only on touch devices
// (mouse keeps the existing selection→FAB path). Classifies a single-finger
// interaction on `target` (using selections from `win`) into:
//   DRAG-SELECT → onSelect()   (PDF only; EPUB selection comes from epubjs)
//   SWIPE       → onSwipe(dir)  (EPUB only)
//   TAP         → onTap(x, y)   (normal mode only; batch marking uses click)
//   SCROLL      → ignored
//
// Touch events (not pointer events) are used deliberately: a tap calls
// preventDefault() on touchend, which suppresses the compatibility mouse events
// (mousedown/click). That stops the panel-lifecycle's mousedown handler from
// instantly dismissing a panel we just opened. In batch mode we do NOT
// preventDefault, so the synthetic click still reaches the batch controller.

const TAP_MOVE_PX = 10;
const TAP_MS = 300;
const SWIPE_DX = 50;

export function setupReaderGestures(target, win, { isEpub, isBatchActive, onTap, onSelect, onSwipe }) {
  let sx = 0;
  let sy = 0;
  let st = 0;
  let tracking = false;

  function onStart(e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    st = Date.now();
  }

  function onEnd(e) {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const dt = Date.now() - st;

    const sel = win.getSelection?.();
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;

    // 1) selection wins over everything (never turns into a swipe/tap)
    if (hasSelection) {
      if (!isEpub) onSelect?.(); // EPUB selection is delivered via rendition.on('selected')
      return;
    }
    // 2) horizontal swipe (EPUB page turn)
    if (isEpub && Math.abs(dx) > SWIPE_DX && Math.abs(dx) > 2 * Math.abs(dy)) {
      e.preventDefault();
      onSwipe?.(dx < 0 ? "next" : "prev");
      return;
    }
    // 3) tap (no real movement, quick)
    if (Math.abs(dx) <= TAP_MOVE_PX && Math.abs(dy) <= TAP_MOVE_PX && dt <= TAP_MS) {
      if (isBatchActive()) return; // batch marking handled by mode.js click handler
      e.preventDefault(); // suppress compat mousedown → panel won't insta-dismiss
      onTap?.(t.clientX, t.clientY);
    }
    // 4) else: vertical drag = scroll → ignore
  }

  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchend", onEnd, { passive: false });
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchend", onEnd);
  };
}
