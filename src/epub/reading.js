// EPUB reading comfort controls: font size, line height, theme.
// Uses epubjs's themes API (injects CSS into each chapter iframe; epubjs
// re-applies to new chapters automatically, so we only set state once + on tap).
// Settings persist in localStorage so they carry across books and sessions.

const THEMES = {
  light: { color: "#1a1a2e", background: "#fafaf6" },
  dark: { color: "#cfd2da", background: "#15151f" },
  sepia: { color: "#5b4636", background: "#f4ecd8" },
};
const THEME_ORDER = ["light", "dark", "sepia"];
const THEME_LABEL = { light: "☀ 亮", dark: "🌙 暗", sepia: "📖 护眼" };
const LINE_HEIGHTS = [1.3, 1.5, 1.8, 2.1];
const FONT_MIN = 80;
const FONT_MAX = 220;
const KEY = { font: "epub_font", lh: "epub_lh", theme: "epub_theme" };

function readSettings() {
  const font = Math.min(FONT_MAX, Math.max(FONT_MIN, parseInt(localStorage.getItem(KEY.font), 10) || 110));
  const lh = LINE_HEIGHTS.includes(parseFloat(localStorage.getItem(KEY.lh)))
    ? parseFloat(localStorage.getItem(KEY.lh))
    : 1.5;
  const theme = THEME_ORDER.includes(localStorage.getItem(KEY.theme)) ? localStorage.getItem(KEY.theme) : "light";
  return { font, lh, theme };
}

export function setupReadingControls(rendition, viewer, nav) {
  let { font, lh, theme } = readSettings();

  for (const name of THEME_ORDER) {
    rendition.themes.register(name, {
      body: { color: THEMES[name].color, background: THEMES[name].background },
      "a:link": { color: "#7c83fd" },
      "::selection": { background: "rgba(124, 131, 253, 0.35)" },
    });
  }

  function apply() {
    rendition.themes.select(theme);
    rendition.themes.fontSize(`${font}%`);
    rendition.themes.override("line-height", String(lh), true);
    viewer.style.background = THEMES[theme].background; // letterbox margins match page
    localStorage.setItem(KEY.font, String(font));
    localStorage.setItem(KEY.lh, String(lh));
    localStorage.setItem(KEY.theme, theme);
    themeBtn.textContent = THEME_LABEL[theme];
  }

  const ctrl = document.createElement("div");
  ctrl.className = "epub-reading-ctrl";
  ctrl.innerHTML = `
    <button class="epub-nav-btn" data-act="font-down" type="button" aria-label="字号减小">A−</button>
    <button class="epub-nav-btn" data-act="font-up" type="button" aria-label="字号增大">A+</button>
    <button class="epub-nav-btn" data-act="lh" type="button" aria-label="切换行距">行距</button>
    <button class="epub-nav-btn" data-act="theme" type="button" aria-label="切换主题"></button>
  `;
  nav.appendChild(ctrl);
  const themeBtn = ctrl.querySelector('[data-act="theme"]');

  ctrl.addEventListener("click", (e) => {
    const act = e.target?.dataset?.act;
    if (act === "font-down") font = Math.max(FONT_MIN, font - 10);
    else if (act === "font-up") font = Math.min(FONT_MAX, font + 10);
    else if (act === "lh") lh = LINE_HEIGHTS[(LINE_HEIGHTS.indexOf(lh) + 1) % LINE_HEIGHTS.length];
    else if (act === "theme") theme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    else return;
    apply();
  });

  apply();
}
