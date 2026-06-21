/**
 * Dedicated test file (own module registry) so the module-level Tesseract worker pool in
 * ocrExtractor.ts starts fresh — verifies OCR now uses a pool of several workers instead of
 * a single shared instance (the single instance would only ever call createWorker once).
 */
import { describe, it, expect, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

const { mockRecognize } = vi.hoisted(() => ({ mockRecognize: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockImplementation(async () => ({
    recognize: mockRecognize,
    terminate: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createWorker } from "tesseract.js";
import { ocrPage, configureOcrWorkerPool } from "./ocrExtractor";

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

  it("configureOcrWorkerPool(size) recrée le pool avec la nouvelle taille au prochain appel OCR", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
    mockRecognize.mockResolvedValue({ data: { text: "", confidence: 0 } });

    // Force une taille de départ connue — ne pas dépendre de la taille par défaut (qui dépend
    // de navigator.hardwareConcurrency de la machine de test) ni de l'état laissé par les
    // tests précédents de ce fichier (le pool est un singleton au niveau du module).
    configureOcrWorkerPool(2);
    await ocrPage(makePage(), "crop"); // initialise (ou réutilise) le pool de taille 2
    const callsBeforeResize = vi.mocked(createWorker).mock.calls.length;

    configureOcrWorkerPool(5); // taille différente de 2 → vrai resize garanti
    await ocrPage(makePage(), "crop"); // déclenche l'init paresseuse du nouveau pool (5 workers)
    const callsAfterResize = vi.mocked(createWorker).mock.calls.length;

    expect(callsAfterResize).toBe(callsBeforeResize + 5);
  });

  it("configureOcrWorkerPool(size) ne recrée rien si la taille est inchangée", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
    mockRecognize.mockResolvedValue({ data: { text: "", confidence: 0 } });

    configureOcrWorkerPool(3); // taille de départ connue
    await ocrPage(makePage(), "crop"); // initialise le pool de taille 3
    const callsBefore = vi.mocked(createWorker).mock.calls.length;

    configureOcrWorkerPool(3); // même taille que celle déjà active → no-op garanti

    await ocrPage(makePage(), "crop"); // réutilise un worker inactif, aucun nouvel appel
    expect(vi.mocked(createWorker).mock.calls.length).toBe(callsBefore);
  });
});
