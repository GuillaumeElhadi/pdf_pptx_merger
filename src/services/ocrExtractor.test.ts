import { describe, it, expect, vi, beforeEach } from "vitest";
import { ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

// mockRecognize: defined via vi.hoisted so it's available inside the vi.mock factory
const { mockRecognize } = vi.hoisted(() => ({ mockRecognize: vi.fn() }));

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockResolvedValue({ recognize: mockRecognize }),
}));

function makePage() {
  return {
    getViewport: vi.fn().mockImplementation(({ scale = 1 } = {}) => ({
      width: 200 * scale,
      height: 300 * scale,
    })),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  } as unknown as PDFPageProxy;
}

beforeEach(() => {
  // jsdom canvas.getContext("2d") returns null — override so ocrPage doesn't throw
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
  // jsdom canvas.toDataURL() returns null — override with a stable data URL string
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
  // Reset one-time mock queues AND set a safe default
  mockRecognize.mockReset();
  mockRecognize.mockResolvedValue({ data: { text: "" } });
});

// ── ocrPage ───────────────────────────────────────────────────────────────────

describe("ocrPage — rotation parameter", () => {
  it("transmet rotation=90 au viewport pdfjs", async () => {
    const page = makePage();
    await ocrPage(page, "crop", 90);
    expect(page.getViewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 }));
  });

  it("utilise rotation=0 si non spécifiée", async () => {
    const page = makePage();
    await ocrPage(page, "crop");
    expect(page.getViewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 0 }));
  });
});

// ── ocrPageWithAutoRotation ───────────────────────────────────────────────────

describe("ocrPageWithAutoRotation — sélection de rotation", () => {
  it("retourne rotationCorrection=0 si rotation=0 donne ≥ 15 caractères alphanumériques", async () => {
    mockRecognize.mockResolvedValue({
      data: { text: "Bonjour monde test programme abc" }, // 28 alphanum chars
    });
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page);
    expect(result.rotationCorrection).toBe(0);
    expect(result.text).toBe("Bonjour monde test programme abc");
    // Only one getViewport call: rotation=0 succeeded on first try
    expect(page.getViewport).toHaveBeenCalledTimes(1);
  });

  it("retourne rotationCorrection=90 si rotation=0 échoue mais rotation=90 réussit", async () => {
    mockRecognize
      .mockResolvedValueOnce({ data: { text: "" } }) // rotation=0 crop: no text
      .mockResolvedValueOnce({ data: { text: "Texte lisible en français programme" } }); // rotation=90 crop: good
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page);
    expect(result.rotationCorrection).toBe(90);
    expect(result.text).toBe("Texte lisible en français programme");
  });

  it("tente full OCR à 0° si aucune rotation de crop ne donne de texte", async () => {
    // 4 crop attempts + 1 full attempt
    mockRecognize
      .mockResolvedValueOnce({ data: { text: "" } }) // 0° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 90° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 180° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 270° crop
      .mockResolvedValueOnce({ data: { text: "Texte complet trouvé en pleine page" } }); // full at 0°
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page);
    expect(result.rotationCorrection).toBe(0);
    expect(mockRecognize).toHaveBeenCalledTimes(5);
  });
});
