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

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const worker = await ensureWorker();
  const {
    data: { text },
  } = await worker.recognize(blob);
  return text;
}
