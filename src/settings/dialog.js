// Minimal settings dialog — DeepSeek API key + Eudic token.
// Plain modal because the alternative (a separate /settings route) is overkill
// for two text fields, and Tauri doesn't ship browser-style settings UI.

import { getKeys, setKeys } from "../lookup/api.js";

const DIALOG_ID = "ctxvocab-settings";

export function openSettings() {
  document.getElementById(DIALOG_ID)?.remove();
  const { deepseek_key, eudic_token } = getKeys();

  const dlg = document.createElement("div");
  dlg.id = DIALOG_ID;
  dlg.className = "ctxvocab-settings-overlay";
  dlg.innerHTML = `
    <div class="ctxvocab-settings-panel">
      <div class="ctxvocab-settings-head">
        <h2>设置</h2>
        <button class="ctxvocab-settings-close" type="button" aria-label="关闭">×</button>
      </div>
      <label class="ctxvocab-settings-field">
        <span>DeepSeek API Key</span>
        <input type="password" data-key="deepseek_key" autocomplete="off" placeholder="sk-…" />
      </label>
      <label class="ctxvocab-settings-field">
        <span>欧陆 OpenAPI Token</span>
        <input type="password" data-key="eudic_token" autocomplete="off" placeholder="访问 my.eudic.net 获取" />
      </label>
      <p class="ctxvocab-settings-hint">
        Key 仅存在浏览器 localStorage，不会上传任何服务器。<br />
        DeepSeek / 欧陆 直接连接，无需代理。
      </p>
      <div class="ctxvocab-settings-actions">
        <button class="ctxvocab-settings-cancel" type="button">取消</button>
        <button class="ctxvocab-settings-save" type="button">保存</button>
      </div>
    </div>
  `;

  dlg.querySelector('[data-key="deepseek_key"]').value = deepseek_key;
  dlg.querySelector('[data-key="eudic_token"]').value = eudic_token;

  const close = () => dlg.remove();
  dlg.querySelector(".ctxvocab-settings-close").addEventListener("click", close);
  dlg.querySelector(".ctxvocab-settings-cancel").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.querySelector(".ctxvocab-settings-save").addEventListener("click", () => {
    setKeys({
      deepseek_key: dlg.querySelector('[data-key="deepseek_key"]').value.trim(),
      eudic_token: dlg.querySelector('[data-key="eudic_token"]').value.trim(),
    });
    close();
  });

  document.body.appendChild(dlg);
  dlg.querySelector('[data-key="deepseek_key"]').focus();
}
