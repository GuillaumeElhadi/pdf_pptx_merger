/**
 * Tests ZOMBIES pour useMergeStore.generate()
 *
 * generate() est l'opération centrale de l'app : elle charge les PDFs source via pdf-lib,
 * fusionne toutes les pages dans l'ordre, applique les rotations, puis écrit le fichier
 * de sortie. Ces tests couvrent chaque branche en suivant la progression ZOMBIES.
 *
 * Mocks nécessaires (en plus du setup global) :
 *   - ../services/bridge      → Bridge.pickSaveLocation
 *   - pdf-lib                 → PDFDocument.create / load / degrees
 *   - global.fetch            → chargement des bytes PDF via convertFileSrc
 *   - writeFile (setup.ts)    → déjà mocké globalement
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useMergeStore } from "./useMergeStore";
import { Bridge } from "../services/bridge";
import { strings } from "../strings";
import type { PdfItem, SlideItem } from "../types";

// ── Mocks module ──────────────────────────────────────────────────────────────

vi.mock("../services/bridge", () => ({
  Bridge: {
    pickSaveLocation: vi.fn(),
    pickPptxFile: vi.fn(),
    pickPdfFiles: vi.fn(),
    convertPptx: vi.fn(),
    getPdfPageCount: vi.fn(),
    getTempDir: vi.fn(),
    getGoogleDrivePath: vi.fn(),
    extractPdfPage: vi.fn(),
    openFile: vi.fn(),
  },
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: vi.fn(),
    load: vi.fn(),
  },
  // degrees est utilisé pour appliquer les rotations ; on retourne n tel quel
  // pour que les assertions restent lisibles (degrees(90) === 90).
  degrees: vi.fn((n: number) => n),
}));

// ── Factories ─────────────────────────────────────────────────────────────────

function makePdf(id: string, path = `/files/${id}.pdf`): PdfItem {
  return { id, type: "pdf", pdfPath: path, rotation: 0 };
}

function makeSlide(id: string, slideIndex = 0): SlideItem {
  return { id, type: "slide", slideIndex, rotation: 0 };
}

/** Page PDF simulée avec getRotation / setRotation. */
function makePage(initialAngle = 0) {
  return {
    setRotation: vi.fn(),
    getRotation: vi.fn(() => ({ angle: initialAngle })),
  };
}

/**
 * Document source simulé.
 * PDFDocument.load est appelé exactement une fois par chemin unique (cache interne à generate).
 */
function makeSourceDoc(pageCount: number) {
  return {
    getPageCount: vi.fn(() => pageCount),
    getPageIndices: vi.fn(() => Array.from({ length: pageCount }, (_, i) => i)),
  };
}

/** Document de fusion simulé (PDFDocument.create). */
function makeMergedDoc() {
  return {
    copyPages: vi.fn().mockResolvedValue([makePage()]),
    addPage: vi.fn(),
    save: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetStore() {
  useMergeStore.setState({
    pptxPath: null,
    slidePdf: null,
    slideCount: 0,
    items: [],
    selectedIds: new Set(),
    status: "idle",
    statusMessage: strings.status.ready,
    progress: null,
    lastOutputPath: null,
  });
}

beforeEach(() => {
  resetStore();
  // fetch est appelé par loadDoc() avec convertFileSrc(path) → "asset://<path>"
  global.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  } as unknown as Response);
});

// ── Z — Zero : aucun déclencheur ──────────────────────────────────────────────

describe("generate — Z : aucun déclencheur", () => {
  it("ne fait rien si items est vide", async () => {
    await useMergeStore.getState().generate();

    expect(Bridge.pickSaveLocation).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });

  it("ne fait rien si items ne contient que des slides (hasPdf = false)", async () => {
    useMergeStore.setState({ items: [makeSlide("s1"), makeSlide("s2")] });

    await useMergeStore.getState().generate();

    expect(Bridge.pickSaveLocation).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });

  it("ne génère pas si l'utilisateur annule le choix de sortie et qu'il n'y a pas de lastOutputPath", async () => {
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue(null);
    useMergeStore.setState({ items: [makePdf("a")], lastOutputPath: null });

    await useMergeStore.getState().generate();

    expect(writeFile).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });
});

// ── O — One : un seul PDF ─────────────────────────────────────────────────────

describe("generate — O : un seul PDF", () => {
  it("enregistre le fichier de sortie et passe à idle", async () => {
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([makePage()]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a", "/a.pdf")] });
    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledWith("/out/result.pdf", expect.any(Uint8Array));
    const s = useMergeStore.getState();
    expect(s.status).toBe("idle");
    expect(s.progress).toBeNull();
    expect(s.lastOutputPath).toBe("/out/result.pdf");
  });

  it("statusMessage reflète le chemin de sortie après succès", async () => {
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([makePage()]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();

    expect(useMergeStore.getState().statusMessage).toBe(
      strings.status.pdfSaved("/out/result.pdf")
    );
  });

  it("addPage appelé exactement une fois pour un PDF d'une page", async () => {
    const page = makePage();
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([page]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a", "/a.pdf")] });
    await useMergeStore.getState().generate();

    expect(mergedDoc.addPage).toHaveBeenCalledTimes(1);
    expect(mergedDoc.addPage).toHaveBeenCalledWith(page);
  });
});

// ── M — Many : plusieurs items ────────────────────────────────────────────────

describe("generate — M : plusieurs items", () => {
  it("fusionne deux PDFs : addPage appelé pour chaque page des deux docs", async () => {
    const [p1, p2, p3] = [makePage(), makePage(), makePage()];
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages
      .mockResolvedValueOnce([p1, p2]) // /a.pdf — 2 pages
      .mockResolvedValueOnce([p3]); // /b.pdf — 1 page

    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(2) as any) // /a.pdf (preload)
      .mockResolvedValueOnce(makeSourceDoc(1) as any); // /b.pdf (preload)
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")],
    });
    await useMergeStore.getState().generate();

    expect(mergedDoc.addPage).toHaveBeenCalledTimes(3);
    expect(mergedDoc.addPage).toHaveBeenNthCalledWith(1, p1);
    expect(mergedDoc.addPage).toHaveBeenNthCalledWith(2, p2);
    expect(mergedDoc.addPage).toHaveBeenNthCalledWith(3, p3);
  });

  it("fusionne un PDF puis un slide dans l'ordre correct", async () => {
    const pdfPage = makePage();
    const slidePage = makePage();
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages
      .mockResolvedValueOnce([pdfPage]) // /a.pdf
      .mockResolvedValueOnce([slidePage]); // slide index 1

    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    // loadDoc est appelé une fois par chemin unique (cache interne)
    // Ordre : /a.pdf (preload PDF), /slides.pdf (preload après boucle)
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(1) as any) // /a.pdf
      .mockResolvedValueOnce(makeSourceDoc(3) as any); // /slides.pdf
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makeSlide("s", 1)],
      slidePdf: "/slides.pdf",
    });
    await useMergeStore.getState().generate();

    expect(mergedDoc.addPage).toHaveBeenCalledTimes(2);
    expect(mergedDoc.addPage).toHaveBeenNthCalledWith(1, pdfPage);
    expect(mergedDoc.addPage).toHaveBeenNthCalledWith(2, slidePage);
  });

  it("copyPages appelé avec le slideIndex correct pour chaque slide", async () => {
    const [pdfPage, s0Page, s2Page] = [makePage(), makePage(), makePage()];
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages
      .mockResolvedValueOnce([pdfPage]) // PDF item
      .mockResolvedValueOnce([s0Page]) // slide index 0
      .mockResolvedValueOnce([s2Page]); // slide index 2

    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(1) as any) // /a.pdf
      .mockResolvedValueOnce(makeSourceDoc(5) as any); // /slides.pdf
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makeSlide("s1", 0), makeSlide("s2", 2)],
      slidePdf: "/slides.pdf",
    });
    await useMergeStore.getState().generate();

    const calls = mergedDoc.copyPages.mock.calls;
    // Appel 0 : PDF — getPageIndices() → [0]
    // Appel 1 : slide s1 → [0]
    expect(calls[1][1]).toEqual([0]);
    // Appel 2 : slide s2 → [2]
    expect(calls[2][1]).toEqual([2]);
  });
});

// ── B — Boundaries : limites ──────────────────────────────────────────────────

describe("generate — B : limites", () => {
  it("progress passe par 0, puis 1, puis null (reset après succès)", async () => {
    const progressHistory: (number | null)[] = [];
    const unsub = useMergeStore.subscribe((s) => progressHistory.push(s.progress));

    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([makePage()]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();
    unsub();

    expect(progressHistory).toContain(0); // set avant la boucle
    expect(progressHistory).toContain(1); // 1/1 page traitée
    expect(progressHistory[progressHistory.length - 1]).toBeNull(); // reset au succès
  });

  it("rotation = 0 → setRotation pas appelé", async () => {
    const page = makePage(0);
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([page]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [{ ...makePdf("a"), rotation: 0 }] });
    await useMergeStore.getState().generate();

    expect(page.setRotation).not.toHaveBeenCalled();
  });

  it("rotation = 90 → setRotation appelé avec 90", async () => {
    const page = makePage(0);
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([page]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [{ ...makePdf("a"), rotation: 90 as const }] });
    await useMergeStore.getState().generate();

    // (page.angle 0 + rotation 90) % 360 = 90
    expect(page.setRotation).toHaveBeenCalledWith(90);
  });

  it("rotation = 270 sur une page déjà à 90° → setRotation appelé avec 0 (bouclage modulo)", async () => {
    const page = makePage(90); // page déjà à 90°
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([page]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [{ ...makePdf("a"), rotation: 270 as const }] });
    await useMergeStore.getState().generate();

    // (90 + 270) % 360 = 0
    expect(page.setRotation).toHaveBeenCalledWith(0);
  });
});

// ── I — Interface : contrat entrée/sortie ─────────────────────────────────────

describe("generate — I : contrat d'interface", () => {
  it("fetch appelé avec l'URL asset:// construite par convertFileSrc", async () => {
    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a", "/docs/file.pdf")] });
    await useMergeStore.getState().generate();

    // convertFileSrc est mocké dans setup.ts : (path) => `asset://${path}`
    expect(global.fetch).toHaveBeenCalledWith("asset:///docs/file.pdf");
  });

  it("writeFile appelé avec les bytes exacts retournés par merged.save()", async () => {
    const expectedBytes = new Uint8Array([9, 8, 7, 6]);
    const mergedDoc = makeMergedDoc();
    mergedDoc.save.mockResolvedValue(expectedBytes);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledWith("/out/result.pdf", expectedBytes);
  });

  it("status transite par 'merging' puis revient à 'idle'", async () => {
    const statusHistory: string[] = [];
    const unsub = useMergeStore.subscribe((s) => statusHistory.push(s.status));

    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();
    unsub();

    expect(statusHistory).toContain("merging");
    expect(statusHistory[statusHistory.length - 1]).toBe("idle");
  });
});

// ── E — Exceptions : gestion d'erreurs ───────────────────────────────────────

describe("generate — E : exceptions", () => {
  it("status = error et progress = null si fetch échoue", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.mocked(PDFDocument.create).mockResolvedValue(makeMergedDoc() as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();

    const s = useMergeStore.getState();
    expect(s.status).toBe("error");
    expect(s.progress).toBeNull();
    expect(s.statusMessage).toContain("Network error");
  });

  it("status = error et progress = null si writeFile rejette", async () => {
    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("Disk full"));

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();

    const s = useMergeStore.getState();
    expect(s.status).toBe("error");
    expect(s.progress).toBeNull();
    expect(s.statusMessage).toContain("Disk full");
  });

  it("status = error si PDFDocument.create rejette", async () => {
    vi.mocked(PDFDocument.create).mockRejectedValue(new Error("pdf-lib internal error"));
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a")] });
    await useMergeStore.getState().generate();

    expect(useMergeStore.getState().status).toBe("error");
    expect(useMergeStore.getState().progress).toBeNull();
  });

  it("slide ignoré (sans planter) quand slidePdf est null", async () => {
    const pdfPage = makePage();
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages.mockResolvedValue([pdfPage]);
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    // PDF + slide, mais slidePdf absent → slide skippé via `if (!slidePdf) continue`
    useMergeStore.setState({
      items: [makePdf("a"), makeSlide("s")],
      slidePdf: null,
    });
    await useMergeStore.getState().generate();

    expect(mergedDoc.addPage).toHaveBeenCalledTimes(1);
    expect(useMergeStore.getState().status).toBe("idle");
  });
});

// ── S — Scenarios : scénarios utilisateur complets ────────────────────────────

describe("generate — S : scénarios", () => {
  it("S1 — réutilise lastOutputPath si l'utilisateur confirme", async () => {
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);

    useMergeStore.setState({
      items: [makePdf("a")],
      lastOutputPath: "/prev/output.pdf",
    });
    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledWith("/prev/output.pdf", expect.any(Uint8Array));
  });

  it("S2 — annule si l'utilisateur refuse de réutiliser lastOutputPath", async () => {
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    useMergeStore.setState({
      items: [makePdf("a")],
      lastOutputPath: "/prev/output.pdf",
    });
    await useMergeStore.getState().generate();

    expect(writeFile).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });

  it("S3 — PDF(2p, rot=90) + slide(rot=0) + PDF(1p, rot=0) : 4 pages, rotations sélectives", async () => {
    const [p1, p2, slidePage, p3] = [makePage(), makePage(), makePage(), makePage()];
    const mergedDoc = makeMergedDoc();
    mergedDoc.copyPages
      .mockResolvedValueOnce([p1, p2]) // /a.pdf — 2 pages, rotation=90
      .mockResolvedValueOnce([slidePage]) // slide index 2, rotation=0
      .mockResolvedValueOnce([p3]); // /b.pdf — 1 page, rotation=0

    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    // Ordre des appels PDFDocument.load : /a.pdf → /b.pdf (preload), puis /slides.pdf (après boucle)
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(2) as any) // /a.pdf
      .mockResolvedValueOnce(makeSourceDoc(1) as any) // /b.pdf
      .mockResolvedValueOnce(makeSourceDoc(5) as any); // /slides.pdf
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({
      items: [
        { ...makePdf("a", "/a.pdf"), rotation: 90 as const },
        makeSlide("s", 2),
        { ...makePdf("b", "/b.pdf"), rotation: 0 as const },
      ],
      slidePdf: "/slides.pdf",
    });
    await useMergeStore.getState().generate();

    expect(mergedDoc.addPage).toHaveBeenCalledTimes(4);
    // Pages de /a.pdf (rotation=90) → setRotation appelé
    expect(p1.setRotation).toHaveBeenCalledWith(90);
    expect(p2.setRotation).toHaveBeenCalledWith(90);
    // Slide et /b.pdf (rotation=0) → setRotation pas appelé
    expect(slidePage.setRotation).not.toHaveBeenCalled();
    expect(p3.setRotation).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });
});
