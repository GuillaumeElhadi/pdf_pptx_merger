import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";

// Module-level cache: cacheKey = `${filePath}#${pageIndex}` → PNG object URL.
// Entries persist for the lifetime of the app — pages are never re-rendered.
const renderedPageCache = new Map<string, string>();

/**
 * Renders a single page of a local PDF file as a PNG object URL.
 *
 * The rendered bitmap is cached by `filePath + pageIndex` — repeated calls
 * with the same arguments return the existing URL without re-rendering.
 */
export async function renderPage(
  filePath: string,
  pageIndex: number = 0,
  width: number = 160
): Promise<string> {
  const cacheKey = `${filePath}#${pageIndex}`;
  const cached = renderedPageCache.get(cacheKey);
  if (cached) return cached;

  // Convert the local absolute path to a URL Tauri's asset protocol can serve
  const url = convertFileSrc(filePath);

  const pdf = await pdfjsLib.getDocument(url).promise;

  try {
    const page = await pdf.getPage(pageIndex + 1); // pdfjs is 1-based

    const viewport = page.getViewport({ scale: 1 });
    const scale = width / viewport.width;
    const scaled = page.getViewport({ scale });

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
