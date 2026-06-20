import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Rotation } from "../types";

// Module-level cache: cacheKey = `${filePath}#${pageIndex}#${rotationCorrection}` → PNG object URL.
// Entries persist for the lifetime of the app — pages are never re-rendered.
const renderedPageCache = new Map<string, string>();

/**
 * Renders a single page of a local PDF file as a PNG object URL.
 *
 * The rendered bitmap is cached by `filePath + pageIndex + rotationCorrection` — repeated calls
 * with the same arguments return the existing URL without re-rendering.
 *
 * `rotationCorrection` is additive on top of the page's own `/Rotate` attribute.
 * When 0 (the default), behaviour is identical to not passing the parameter.
 */
export async function renderPage(
  filePath: string,
  pageIndex: number = 0,
  width: number = 160,
  rotationCorrection: Rotation = 0
): Promise<string> {
  const cacheKey = `${filePath}#${pageIndex}#${rotationCorrection}`;
  const cached = renderedPageCache.get(cacheKey);
  if (cached) return cached;

  // Convert the local absolute path to a URL Tauri's asset protocol can serve
  const url = convertFileSrc(filePath);

  const pdf = await pdfjsLib.getDocument(url).promise;

  try {
    const page = await pdf.getPage(pageIndex + 1); // pdfjs is 1-based

    // pdfjs's `rotation` param is absolute, not additive — passing it (even 0)
    // overrides the page's own /Rotate. Add it to page.rotate to get true
    // additive behaviour and preserve any inherent rotation already baked in.
    const totalRotation = (((page.rotate ?? 0) + rotationCorrection) % 360) as Rotation;

    const viewport = page.getViewport({ scale: 1, rotation: totalRotation });
    const scale = width / viewport.width;
    const scaled = page.getViewport({ scale, rotation: totalRotation });

    const canvas = new OffscreenCanvas(Math.floor(scaled.width), Math.floor(scaled.height));
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaled,
    }).promise;

    const blob = await canvas.convertToBlob({ type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    renderedPageCache.set(cacheKey, objectUrl);
    return objectUrl;
  } finally {
    await pdf.destroy();
  }
}
