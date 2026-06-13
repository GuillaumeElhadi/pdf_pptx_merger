import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { createWorker, type Worker } from "tesseract.js";
import type { Rotation } from "../types";

let workerInstance: Worker | null = null;
let workerFailed = false;

async function ensureWorker(): Promise<Worker> {
  if (workerFailed) throw new Error("Tesseract worker failed to initialize");
  if (workerInstance) return workerInstance;

  const base = window.location.origin + "/tessdata";
  // createWorker's internal `.catch(() => {})` swallows loadLanguage/initialize
  // failures without rejecting workerRes, causing it to hang forever.
  // The timeout unblocks us if that happens.
  // errorHandler prevents createWorker from throwing inside its onMessage callback
  // (which would become an unhandled error, triggering Vite's error overlay).
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Tesseract worker init timed out after 15 s")), 15_000)
  );

  try {
    workerInstance = await Promise.race([
      createWorker("fra", 1, {
        workerPath: `${base}/worker.min.js`,
        langPath: base,
        corePath: base,
        gzip: false,
        logger: () => {},
        errorHandler: (err: unknown) => {
          console.error("[Tesseract] worker error:", err);
        },
      }),
      timeout,
    ]);
  } catch (e) {
    workerFailed = true;
    throw e;
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
export async function ocrPage(
  page: PDFPageProxy,
  strategy: "crop" | "full",
  rotation: Rotation = 0
): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5, rotation });
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
    // For the crop strategy, skip the leftmost 33% to exclude the management
    // company left column that shares Y positions with center/right columns,
    // causing Tesseract to merge their text onto single lines and breaking
    // pattern matching (e.g. "D 403 123 Du 01/01/2025 au..." instead of
    // "Du 01/01/2025 au..." alone on its line).
    const leftSkip = strategy === "crop" ? Math.floor(width * 0.33) : 0;
    const recognizeOptions =
      leftSkip > 0
        ? { rectangle: { left: leftSkip, top: 0, width: width - leftSkip, height } }
        : undefined;
    const {
      data: { text },
    } = await worker.recognize(dataUrl, recognizeOptions);
    console.info("[ocrPage] recognize OK, chars:", text.length);
    return text;
  } catch (e) {
    console.error("[ocrPage] recognize FAILED:", String(e));
    throw e;
  }
}

function countAlphanumeric(text: string): number {
  return (text.match(/[a-zA-ZÀ-ÿ0-9]/g) ?? []).length;
}

/**
 * Tries canvas rotations 0°→90°→180°→270° using crop OCR.
 *
 * When `validate` is provided, returns the first rotation where validate(text) is true.
 * Without `validate`, returns the first rotation yielding ≥ 15 alphanumeric chars.
 *
 * Falls back to full-page OCR at the rotation with the most alphanumeric chars if no
 * crop attempt passes the criterion. Callers are responsible for any additional
 * full-page fallback at the detected rotation.
 */
export async function ocrPageWithAutoRotation(
  page: PDFPageProxy,
  validate?: (text: string) => boolean
): Promise<{ text: string; rotationCorrection: Rotation }> {
  let bestRotation: Rotation = 0;
  let bestScore = -1;

  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const text = await ocrPage(page, "crop", rotation);
    const isValid = validate ? validate(text) : countAlphanumeric(text) >= 15;

    if (isValid) {
      return { text, rotationCorrection: rotation };
    }

    const score = countAlphanumeric(text);
    if (score > bestScore) {
      bestScore = score;
      bestRotation = rotation;
    }
  }

  return { text: await ocrPage(page, "full", bestRotation), rotationCorrection: bestRotation };
}
