import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { createWorker, type Worker } from "tesseract.js";
import type { Rotation } from "../types";
import { createWorkerPool } from "../utils/workerPool";
import { loadPerformanceLevel, workerCountForLevel } from "../utils/performanceSettings";

async function createTesseractWorker(): Promise<Worker> {
  const base = window.location.origin + "/tessdata";
  // createWorker's internal `.catch(() => {})` swallows loadLanguage/initialize
  // failures without rejecting workerRes, causing it to hang forever.
  // The timeout unblocks us if that happens.
  // errorHandler prevents createWorker from throwing inside its onMessage callback
  // (which would become an unhandled error, triggering Vite's error overlay).
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Tesseract worker init timed out after 15 s")), 15_000)
  );

  return Promise.race([
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
}

/**
 * Tesseract.js workers process one recognize() job at a time each, so a single shared
 * worker serializes all OCR regardless of how many files/pages are processed "concurrently"
 * upstream. A pool lets that many OCR jobs actually run in parallel — sized to match the
 * user's chosen performance level (see useMergeStore.ts's performanceLevel), defaulting to
 * the persisted level on module load so the pool is correctly sized even before the store
 * explicitly configures it.
 */
let currentPoolSize = workerCountForLevel(loadPerformanceLevel());
let workerPool = createWorkerPool(currentPoolSize, createTesseractWorker);

/**
 * Resizes the OCR worker pool. No-op if `size` matches the current size. Idle workers from
 * the old pool are terminated immediately; workers currently mid-job are not interrupted —
 * they keep running and release back into their original (now-retired) pool, where they sit
 * unused until app restart. This is an accepted, rare-case limitation (changing the setting
 * mid-batch), not handled further to avoid extra complexity.
 */
export function configureOcrWorkerPool(size: number): void {
  if (size === currentPoolSize) return;
  const oldPool = workerPool;
  currentPoolSize = size;
  workerPool = createWorkerPool(size, createTesseractWorker);
  oldPool.drainIdle().forEach((worker) => {
    void worker.terminate();
  });
}

/**
 * Renders a pdfjs page to canvas and returns the OCR text.
 *
 * "crop"   — top 35%, left 33% skipped (~0.5s). Owner detection: the owner label
 *            appears in the top-right of the page in known documents.
 * "detect" — top 50%, no left skip (~0.6s). Rotation detection: wider crop to
 *            maximise text coverage for alphanumeric counting.
 * "full"   — entire page (~2-3s). Fallback when crop finds no owner.
 */
export async function ocrPage(
  page: PDFPageProxy,
  strategy: "crop" | "detect" | "full",
  rotation: Rotation = 0
): Promise<string> {
  const { text } = await recognizePage(page, strategy, rotation);
  return text;
}

/**
 * Same as `ocrPage` but also exposes Tesseract's mean word confidence (0-100).
 *
 * Confidence is a far more reliable orientation signal than raw character count:
 * a page OCR'd at a wrong rotation can still produce a high alphanumeric count
 * (Tesseract still matches plenty of Latin-shaped glyph fragments in upside-down
 * or mirrored text), but its per-word confidence is consistently much lower than
 * the correct orientation's.
 */
async function recognizePage(
  page: PDFPageProxy,
  strategy: "crop" | "detect" | "full",
  rotation: Rotation = 0
): Promise<{ text: string; confidence: number }> {
  const viewport = page.getViewport({ scale: 1.5, rotation });
  const width = Math.floor(viewport.width);
  const fullHeight = Math.floor(viewport.height);
  const height =
    strategy === "crop"
      ? Math.floor(fullHeight * 0.35)
      : strategy === "detect"
        ? Math.floor(fullHeight * 0.5)
        : fullHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D canvas context");

  console.info("[ocrPage] rendering page to canvas...");
  let dataUrl = "";
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    console.info("[ocrPage] render OK");
    dataUrl = canvas.toDataURL("image/png");
    console.info("[ocrPage] dataUrl ready, length:", dataUrl.length);
  } catch (e) {
    console.error("[ocrPage] render FAILED:", String(e));
    throw e;
  } finally {
    // Release the GPU backing store immediately after extracting the data URL.
    // Without this, processing many PDFs sequentially (up to 5 canvas renders per
    // page for 4-rotation OCR) exhausts the browser's ~300 canvas context limit,
    // causing getContext("2d") to return null for later PDFs and silently dropping
    // all owner detections from those files.
    canvas.width = 0;
    canvas.height = 0;
  }

  let worker: Worker;
  let pool: typeof workerPool;
  try {
    pool = workerPool; // capture the pool in use at acquire time
    worker = await pool.acquire();
    console.info("[ocrPage] worker ready");
  } catch (e) {
    console.error("[ocrPage] worker pool acquire FAILED:", String(e));
    throw e;
  }

  try {
    // For the owner crop strategy, skip the leftmost 33% to exclude the management
    // company left column that shares Y positions with center/right columns,
    // causing Tesseract to merge their text onto single lines and breaking
    // pattern matching (e.g. "D 403 123 Du 01/01/2025 au..." instead of
    // "Du 01/01/2025 au..." alone on its line).
    // The "detect" strategy uses the full width — no left skip.
    const leftSkip = strategy === "crop" ? Math.floor(width * 0.33) : 0;
    const recognizeOptions =
      leftSkip > 0
        ? { rectangle: { left: leftSkip, top: 0, width: width - leftSkip, height } }
        : undefined;
    const {
      data: { text, confidence },
    } = await worker.recognize(dataUrl, recognizeOptions);
    console.info("[ocrPage] recognize OK, chars:", text.length, "confidence:", confidence);
    return { text, confidence };
  } catch (e) {
    console.error("[ocrPage] recognize FAILED:", String(e));
    throw e;
  } finally {
    pool.release(worker);
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
  let bestConfidence = -1;

  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const { text, confidence } = await recognizePage(page, "crop", rotation);
    const isValid = validate ? validate(text) : countAlphanumeric(text) >= 15;

    if (isValid) {
      return { text, rotationCorrection: rotation };
    }

    // Confidence — not raw alphanumeric count — picks the fallback rotation: a wrong
    // orientation can still match plenty of Latin-shaped glyph fragments and out-count
    // the correct one, but its per-word confidence is reliably lower.
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestRotation = rotation;
    }
  }

  return { text: await ocrPage(page, "full", bestRotation), rotationCorrection: bestRotation };
}

/**
 * Detects the reading orientation of a scanned (image-only) page by trying four
 * canvas rotations and returning the one with the highest OCR confidence among
 * those with enough recognized text to be a plausible reading (not noise).
 *
 * Uses the "detect" crop strategy (top 50%, full width) which is more reliable than
 * the owner-specific crop (top 35%, left-33%-skipped) for general rotation detection.
 *
 * Picking by confidence rather than raw alphanumeric count matters: a wrong
 * orientation can still match plenty of Latin-shaped glyph fragments (upside-down or
 * mirrored text still "looks like" letters to Tesseract) and out-count the correct
 * orientation, while its per-word confidence stays much lower.
 *
 * Returns 0 when the page appears to already be correctly oriented OR when no rotation
 * produces enough text to determine orientation reliably (sparse / blank pages).
 */
export async function detectPageRotation(page: PDFPageProxy): Promise<Rotation> {
  // Threshold: enough characters to be confident about orientation.
  // Typical text: hundreds of chars; we just need to distinguish "readable" from noise.
  const DETECTION_THRESHOLD = 25;

  let bestRotation: Rotation = 0;
  let bestConfidence = -1;
  let anyPassed = false;

  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const { text, confidence } = await recognizePage(page, "detect", rotation);
    if (countAlphanumeric(text) < DETECTION_THRESHOLD) continue;

    anyPassed = true;
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestRotation = rotation;
    }
  }

  // No rotation produced enough text to judge orientation (blank/sparse page).
  if (!anyPassed) return 0;

  return bestRotation;
}
