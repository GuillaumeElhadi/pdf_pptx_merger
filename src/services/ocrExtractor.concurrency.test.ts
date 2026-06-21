/**
 * Dedicated test file (own module registry) so the module-level Tesseract worker pool in
 * ocrExtractor.ts starts fresh — verifies OCR now uses a pool of several workers instead of
 * a single shared instance (the single instance would only ever call createWorker once).
 */
import { describe, it, expect, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

const { mockRecognize } = vi.hoisted(() => ({ mockRecognize: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockImplementation(async () => ({ recognize: mockRecognize })),
}));

import { createWorker } from "tesseract.js";
import { ocrPage } from "./ocrExtractor";

function makePage() {
  return {
    getViewport: vi.fn().mockImplementation(({ scale = 1 } = {}) => ({
      width: 200 * scale,
      height: 300 * scale,
    })),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  } as unknown as PDFPageProxy;
}

describe("ocrExtractor — pool de workers OCR", () => {
  it("initialise un pool de plusieurs workers dès le premier appel OCR (pas un seul worker partagé)", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
    mockRecognize.mockResolvedValue({ data: { text: "", confidence: 0 } });

    // A single, non-concurrent OCR call. With the old single shared-worker design,
    // createWorker would be called exactly once, deterministically (no race involved).
    // With a pool, the very first acquire() eagerly creates all `size` workers at once.
    await ocrPage(makePage(), "crop");

    expect(vi.mocked(createWorker).mock.calls.length).toBeGreaterThan(1);
  });
});
