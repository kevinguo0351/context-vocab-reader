import "./style.css";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { renderPdf } from "./pdf/render.js";
import { setupCapture } from "./lookup/capture.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const fileInput = document.querySelector("#file-input");
const main = document.querySelector("#reader-main");
const status = document.querySelector("#status");

setupCapture(main);

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  status.textContent = `加载中: ${file.name}…`;
  try {
    const buf = await file.arrayBuffer();
    main.innerHTML = "";
    await renderPdf(pdfjsLib, buf, main, (i, n) => {
      status.textContent = `渲染第 ${i}/${n} 页…`;
    });
    status.textContent = `${file.name} · 共 ${main.querySelectorAll(".pdf-page").length} 页 · 划词试试`;
  } catch (err) {
    console.error(err);
    status.textContent = `加载失败: ${err.message}`;
  }
});
