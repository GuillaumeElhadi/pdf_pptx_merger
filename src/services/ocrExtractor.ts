import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { createWorker, type Worker } from "tesseract.js";

let workerInstance: Worker | null = null;

async function ensureWorker(): Promise<Worker> {
  if (!workerInstance) {
    const base = window.location.origin + "/tessdata";
    workerInstance = await createWorker("fra", 1, {
      workerPath: `${base}/worker.min.js`,
      langPath: base,
      corePath: base,
      gzip: false,
      // Suppress Tesseract's per-page progress logs in the browser console
      logger: () => {},
    });
  }
  return workerInstance;
}

/**
 * Renders a pdfjs page to canvas and returns the OCR text.
 *
 * "crop"  — top 35% of the page only (~0.5s). Use first: the owner label
 *           always appears in the top third of the page in known documents.
 * "full"  — entire page (~2-3s). Fallback when crop finds no owner.
 */
export async function ocrPage(page: PDFPageProxy, strategy: "crop" | "full"): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5 });
  const width = Math.floor(viewport.width);
  const fullHeight = Math.floor(viewport.height);
  const height = strategy === "crop" ? Math.floor(fullHeight * 0.35) : fullHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  console.info("[ocrPage] rendering page to canvas...");
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    console.info("[ocrPage] render OK");
  } catch (e) {
    console.error("[ocrPage] render FAILED:", String(e));
    throw e;
  }

  const dataUrl = canvas.toDataURL("image/png");
  console.info("[ocrPage] dataUrl ready, length:", dataUrl.length);

  let worker: Worker;
  try {
    worker = await ensureWorker();
    console.info("[ocrPage] worker ready");
  } catch (e) {
    console.error("[ocrPage] ensureWorker FAILED:", String(e));
    throw e;
  }

  try {
    const {
      data: { text },
    } = await worker.recognize(dataUrl);
    console.info("[ocrPage] recognize OK, chars:", text.length);
    return text;
  } catch (e) {
    console.error("[ocrPage] recognize FAILED:", String(e));
    throw e;
  }
}
