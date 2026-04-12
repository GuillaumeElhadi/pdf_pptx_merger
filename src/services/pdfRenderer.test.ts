/**
 * Tests ZOMBIES pour renderPage() — src/services/pdfRenderer.ts
 *
 * Particularités techniques :
 *  - Cache module-level (Map) partagé sur toute la durée du fichier de tests.
 *    → Chaque test utilise un chemin unique via freshPath() pour éviter les hits
 *      non intentionnels. Le test du cache appelle délibérément le même chemin.
 *  - OffscreenCanvas et URL.createObjectURL absents de jsdom → mockés en beforeEach.
 *  - pdfjs-dist → mocké au niveau module.
 *  - convertFileSrc → mocké dans setup.ts : (path) => `asset://${path}`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as pdfjsLib from "pdfjs-dist";
import { renderPage } from "./pdfRenderer";

// ── Mock pdfjs-dist ───────────────────────────────────────────────────────────

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compteur pour générer des chemins uniques et éviter les hits de cache entre tests. */
let pathCounter = 0;
const freshPath = () => `/render-test-${++pathCounter}.pdf`;

/**
 * Crée une page pdfjs simulée avec des dimensions naturelles données.
 * getViewport est appelé deux fois : d'abord à scale=1 (mesure), puis au scale final.
 */
function makePdfPage(naturalWidth = 200, naturalHeight = 300) {
  return {
    getViewport: vi.fn().mockImplementation(({ scale = 1 }: { scale: number }) => ({
      width: naturalWidth * scale,
      height: naturalHeight * scale,
    })),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  };
}

/** Configure le mock pdfjs pour retourner une doc avec une seule page. */
function setupPdfjs(page = makePdfPage()) {
  vi.mocked(pdfjsLib.getDocument).mockReturnValue({
    promise: Promise.resolve({
      getPage: vi.fn().mockResolvedValue(page),
    }),
  } as any);
  return page;
}

beforeEach(() => {
  // OffscreenCanvas n'existe pas dans jsdom — on le simule
  global.OffscreenCanvas = vi.fn().mockImplementation(() => ({
    getContext: vi.fn().mockReturnValue({}),
    convertToBlob: vi
      .fn()
      .mockResolvedValue(new Blob(["PNG"], { type: "image/png" })),
  })) as any;

  // URL.createObjectURL n'est pas implémenté dans jsdom
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
});

// ── Z — Zero : cas de base / premier appel ────────────────────────────────────

describe("renderPage — Z : premier rendu", () => {
  it("retourne une URL blob non vide", async () => {
    setupPdfjs();
    const url = await renderPage(freshPath(), 0, 160);
    expect(url).toBe("blob:mock-url");
  });

  it("appelle getDocument avec l'URL asset:// construite par convertFileSrc", async () => {
    setupPdfjs();
    const path = freshPath();
    await renderPage(path, 0, 160);
    // convertFileSrc est mocké : (p) => `asset://${p}`
    expect(pdfjsLib.getDocument).toHaveBeenCalledWith(`asset://${path}`);
  });
});

// ── O — One : un rendu complet ────────────────────────────────────────────────

describe("renderPage — O : pipeline de rendu", () => {
  it("appelle page.render() et convertToBlob() exactement une fois", async () => {
    const page = setupPdfjs();
    await renderPage(freshPath(), 0, 160);
    expect(page.render).toHaveBeenCalledTimes(1);
  });

  it("URL.createObjectURL est appelé avec le blob de la canvas", async () => {
    setupPdfjs();
    await renderPage(freshPath(), 0, 160);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});

// ── M — Many : cache ──────────────────────────────────────────────────────────

describe("renderPage — M : comportement du cache", () => {
  it("retourne la même URL si appelé deux fois avec le même chemin et pageIndex", async () => {
    setupPdfjs();
    const path = freshPath();
    const url1 = await renderPage(path, 0, 160);
    // Deuxième appel → cache hit (pdfjs ne doit pas être rappelé)
    const url2 = await renderPage(path, 0, 160);
    expect(url1).toBe(url2);
  });

  it("getDocument n'est appelé qu'une seule fois pour le même chemin (cache hit)", async () => {
    setupPdfjs();
    const path = freshPath();
    await renderPage(path, 0, 160);
    await renderPage(path, 0, 160);
    expect(pdfjsLib.getDocument).toHaveBeenCalledTimes(1);
  });

  it("getDocument est appelé deux fois pour deux pageIndex différents (clés de cache distinctes)", async () => {
    // Deux pages différentes → deux clés de cache → deux renders
    const page0 = makePdfPage();
    const page1 = makePdfPage();
    const doc = {
      getPage: vi.fn()
        .mockResolvedValueOnce(page0)
        .mockResolvedValueOnce(page1),
    };
    vi.mocked(pdfjsLib.getDocument)
      .mockReturnValueOnce({ promise: Promise.resolve(doc) } as any)
      .mockReturnValueOnce({ promise: Promise.resolve(doc) } as any);

    const path = freshPath();
    await renderPage(path, 0, 160);
    await renderPage(path, 1, 160);

    expect(pdfjsLib.getDocument).toHaveBeenCalledTimes(2);
  });
});

// ── B — Boundaries : limites ──────────────────────────────────────────────────

describe("renderPage — B : limites", () => {
  it("pageIndex 0 → pdfjs.getPage appelé avec 1 (conversion 0-based → 1-based)", async () => {
    const doc = { getPage: vi.fn().mockResolvedValue(makePdfPage()) };
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(doc),
    } as any);

    await renderPage(freshPath(), 0, 160);

    expect(doc.getPage).toHaveBeenCalledWith(1);
  });

  it("pageIndex 4 → pdfjs.getPage appelé avec 5", async () => {
    const doc = { getPage: vi.fn().mockResolvedValue(makePdfPage()) };
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(doc),
    } as any);

    await renderPage(freshPath(), 4, 160);

    expect(doc.getPage).toHaveBeenCalledWith(5);
  });

  it("width=160 sur une page 200×300 → OffscreenCanvas(160, 240)", async () => {
    // naturalWidth=200, width cible=160 → scale=0.8
    // scaled.width = 200*0.8 = 160, scaled.height = 300*0.8 = 240
    setupPdfjs(makePdfPage(200, 300));
    await renderPage(freshPath(), 0, 160);

    expect(global.OffscreenCanvas).toHaveBeenCalledWith(160, 240);
  });

  it("width=48 (miniature) sur une page 200×300 → OffscreenCanvas(48, 72)", async () => {
    // scale = 48/200 = 0.24 → scaled: 48×72
    setupPdfjs(makePdfPage(200, 300));
    await renderPage(freshPath(), 0, 48);

    expect(global.OffscreenCanvas).toHaveBeenCalledWith(48, 72);
  });

  it("Math.floor appliqué aux dimensions (pas de canvas fractionnaire)", async () => {
    // naturalWidth=300, width=160 → scale=0.5333..., height=300*0.5333=159.99... → floor=159
    setupPdfjs(makePdfPage(300, 300));
    await renderPage(freshPath(), 0, 160);

    const calls = (global.OffscreenCanvas as ReturnType<typeof vi.fn>).mock.calls;
    const [w, h] = calls[calls.length - 1];
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
  });
});

// ── I — Interface : contrat ───────────────────────────────────────────────────

describe("renderPage — I : contrat d'interface", () => {
  it("retourne une string (l'URL du blob)", async () => {
    setupPdfjs();
    const result = await renderPage(freshPath(), 0, 160);
    expect(typeof result).toBe("string");
  });

  it("page.render() reçoit le bon viewport (celui à l'échelle cible)", async () => {
    const page = setupPdfjs(makePdfPage(200, 300));
    await renderPage(freshPath(), 0, 160);

    const renderCall = page.render.mock.calls[0][0];
    // Le viewport passé à render doit être celui calculé au scale cible (0.8)
    expect(renderCall.viewport.width).toBeCloseTo(160);
    expect(renderCall.viewport.height).toBeCloseTo(240);
  });
});

// ── E — Exceptions ────────────────────────────────────────────────────────────

describe("renderPage — E : exceptions", () => {
  it("propage l'erreur si getDocument rejette", async () => {
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.reject(new Error("PDF corrompu")),
    } as any);

    await expect(renderPage(freshPath(), 0, 160)).rejects.toThrow("PDF corrompu");
  });

  it("propage l'erreur si getPage rejette (page inexistante)", async () => {
    const doc = {
      getPage: vi.fn().mockRejectedValue(new Error("Page inexistante")),
    };
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(doc),
    } as any);

    await expect(renderPage(freshPath(), 99, 160)).rejects.toThrow("Page inexistante");
  });
});
