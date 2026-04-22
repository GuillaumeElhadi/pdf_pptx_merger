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
    pickSaveDirectory: vi.fn(),
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

// owners: [] simulates extraction completed with no owners found (the normal case for a plain PDF)
function makePdf(id: string, path = `/files/${id}.pdf`): PdfItem {
  return { id, type: "pdf", pdfPath: path, rotation: 0, owners: [] };
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
    // Default: returns one makePage() per requested index (mirrors the real api)
    copyPages: vi
      .fn()
      .mockImplementation((_doc: unknown, indices: number[]) =>
        Promise.resolve(indices.map(() => makePage()))
      ),
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
    lastOutputDir: null,
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

  it("ne génère pas si l'extraction des propriétaires est en cours (owners === undefined)", async () => {
    // Item sans owners ni ownersError = extraction toujours en cours
    const pendingItem: PdfItem = { id: "p", type: "pdf", pdfPath: "/a.pdf", rotation: 0 };
    useMergeStore.setState({ items: [pendingItem] });

    await useMergeStore.getState().generate();

    expect(Bridge.pickSaveLocation).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(useMergeStore.getState().statusMessage).toBe(strings.status.ownersNotReady);
  });

  it("génère normalement si l'extraction a échoué (ownersError défini, owners undefined)", async () => {
    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");
    // ownersError set → extraction failed → treated as no-owner, generate continues
    const failedItem: PdfItem = {
      id: "f",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      ownersError: "timeout",
    };
    useMergeStore.setState({ items: [failedItem] });

    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledWith("/out/result.pdf", expect.any(Uint8Array));
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

    expect(useMergeStore.getState().statusMessage).toBe(strings.status.pdfSaved("/out/result.pdf"));
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

// ── Multi-owner split ─────────────────────────────────────────────────────────

describe("generate — multi-owner : split par propriétaire", () => {
  const ownerX = { code: "0000001", name: "OWNER X" };
  const ownerY = { code: "0000002", name: "OWNER Y" };

  it("2 owners → writeFile appelé 2 fois, nommés d'après le propriétaire en snake_case", async () => {
    const pageOwnersMap = new Map([
      [1, ownerX],
      [2, ownerY],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith("/out/owner_x.pdf", expect.any(Uint8Array));
    expect(writeFile).toHaveBeenCalledWith("/out/owner_y.pdf", expect.any(Uint8Array));
  });

  it("statusMessage final reflète le mode split", async () => {
    const pageOwnersMap = new Map([
      [1, ownerX],
      [2, ownerY],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    expect(useMergeStore.getState().statusMessage).toBe(strings.status.splitSaved(2, "/out"));
    expect(useMergeStore.getState().lastOutputDir).toBe("/out");
  });

  it("PDF sans owner → toutes ses pages incluses dans les deux outputs", async () => {
    // pdfNoOwner a 1 page et owners: [] (aucun owner détecté) → inclus dans tous les outputs
    // pdfWithOwners a 2 pages (page1=X, page2=Y)
    const pageOwnersMap = new Map([
      [1, ownerX],
      [2, ownerY],
    ]);
    const pdfNoOwner: PdfItem = makePdf("no", "/no.pdf");
    const pdfWithOwners: PdfItem = {
      ...makePdf("ab", "/ab.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(1) as any) // /no.pdf (1 page)
      .mockResolvedValueOnce(makeSourceDoc(2) as any); // /ab.pdf (2 pages)
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfNoOwner, pdfWithOwners] });
    await useMergeStore.getState().generate();

    // ownerX output: 1 page (no-owner) + 1 page (page 1 of ab = X) = 2 addPage calls
    expect(mergedDocX.addPage).toHaveBeenCalledTimes(2);
    // ownerY output: 1 page (no-owner) + 1 page (page 2 of ab = Y) = 2 addPage calls
    expect(mergedDocY.addPage).toHaveBeenCalledTimes(2);
  });

  it("PDF exclusif à owner X → absent de l'output owner Y", async () => {
    const pdfX: PdfItem = {
      ...makePdf("x", "/x.pdf"),
      owners: [ownerX],
      pageOwners: new Map([[1, ownerX]]),
    };
    const pdfY: PdfItem = {
      ...makePdf("y", "/y.pdf"),
      owners: [ownerY],
      pageOwners: new Map([[1, ownerY]]),
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(1) as any) // /x.pdf
      .mockResolvedValueOnce(makeSourceDoc(1) as any); // /y.pdf
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfX, pdfY] });
    await useMergeStore.getState().generate();

    // X output: only pdfX (1 page)
    expect(mergedDocX.addPage).toHaveBeenCalledTimes(1);
    // Y output: only pdfY (1 page)
    expect(mergedDocY.addPage).toHaveBeenCalledTimes(1);
  });

  it("page orpheline → incluse dans tous les outputs", async () => {
    // 3 pages : page1=X, page2=orphan(absente de pageOwners), page3=Y
    const pageOwnersMap = new Map([
      [1, ownerX],
      [3, ownerY],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(3) as any);
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    // X output: page1 (X) + page2 (orphan) = 2 pages
    expect(mergedDocX.addPage).toHaveBeenCalledTimes(2);
    // Y output: page2 (orphan) + page3 (Y) = 2 pages
    expect(mergedDocY.addPage).toHaveBeenCalledTimes(2);
  });

  it("1 seul owner → mode single (writeFile appelé une fois avec le chemin exact)", async () => {
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX],
      pageOwners: new Map([[1, ownerX]]),
    };

    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/rapport.pdf");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    // Single mode: path unchanged (no _CODE suffix)
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("/out/rapport.pdf", expect.any(Uint8Array));
  });

  it("mode multi-owner → pickSaveDirectory appelé, pickSaveLocation non appelé", async () => {
    const pageOwnersMap = new Map([
      [1, ownerX],
      [2, ownerY],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    expect(Bridge.pickSaveDirectory).toHaveBeenCalled();
    expect(Bridge.pickSaveLocation).not.toHaveBeenCalled();
  });

  it("mode single-owner → pickSaveLocation appelé, pickSaveDirectory non appelé", async () => {
    const mergedDoc = makeMergedDoc();
    vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
    vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

    useMergeStore.setState({ items: [makePdf("a", "/a.pdf")] });
    await useMergeStore.getState().generate();

    expect(Bridge.pickSaveLocation).toHaveBeenCalled();
    expect(Bridge.pickSaveDirectory).not.toHaveBeenCalled();
  });

  it("noms avec accents et ponctuation → chemins snake_case corrects", async () => {
    const ownerA = { code: "0000003", name: "FONCIÈRE ATLANTIQUE" };
    const ownerB = { code: "0000004", name: "S.A.S. IMMO. CARREFOUR" };
    const pageOwnersMap = new Map([
      [1, ownerA],
      [2, ownerB],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerA, ownerB],
      pageOwners: pageOwnersMap,
    };

    const mergedDocA = makeMergedDoc();
    const mergedDocB = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocA as any)
      .mockResolvedValueOnce(mergedDocB as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({ items: [pdfItem] });
    await useMergeStore.getState().generate();

    expect(writeFile).toHaveBeenCalledWith("/out/fonciere_atlantique.pdf", expect.any(Uint8Array));
    expect(writeFile).toHaveBeenCalledWith("/out/s_a_s_immo_carrefour.pdf", expect.any(Uint8Array));
  });

  it("slides toujours incluses dans tous les outputs", async () => {
    const pageOwnersMap = new Map([
      [1, ownerX],
      [2, ownerY],
    ]);
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: pageOwnersMap,
    };
    const slide = makeSlide("s", 0);

    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load)
      .mockResolvedValueOnce(makeSourceDoc(2) as any) // /a.pdf
      .mockResolvedValueOnce(makeSourceDoc(3) as any); // /slides.pdf
    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue("/out");

    useMergeStore.setState({
      items: [slide, pdfItem],
      slidePdf: "/slides.pdf",
    });
    await useMergeStore.getState().generate();

    // X output: 1 slide + 1 pdf page (page1=X) = 2 addPage calls
    expect(mergedDocX.addPage).toHaveBeenCalledTimes(2);
    // Y output: 1 slide + 1 pdf page (page2=Y) = 2 addPage calls
    expect(mergedDocY.addPage).toHaveBeenCalledTimes(2);
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

  it("S4 — lastOutputDir et lastOutputPath sont isolés : reuse multi n'utilise pas lastOutputPath", async () => {
    const ownerX = { code: "0000001", name: "OWNER X" };
    const ownerY = { code: "0000002", name: "OWNER Y" };
    const pdfItem: PdfItem = {
      ...makePdf("a", "/a.pdf"),
      owners: [ownerX, ownerY],
      pageOwners: new Map([
        [1, ownerX],
        [2, ownerY],
      ]),
    };

    vi.mocked(Bridge.pickSaveDirectory).mockResolvedValue(null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const mergedDocX = makeMergedDoc();
    const mergedDocY = makeMergedDoc();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(mergedDocX as any)
      .mockResolvedValueOnce(mergedDocY as any);
    vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);

    // lastOutputPath contient un chemin de fichier (run single précédent)
    // lastOutputDir contient le dossier attendu (run multi précédent)
    useMergeStore.setState({
      items: [pdfItem],
      lastOutputPath: "/prev/single.pdf",
      lastOutputDir: "/prev/dir",
    });
    await useMergeStore.getState().generate();

    // Le confirm de reuse doit avoir été proposé avec le chemin dossier, pas le chemin fichier
    expect(writeFile).toHaveBeenCalledWith("/prev/dir/owner_x.pdf", expect.any(Uint8Array));
    expect(writeFile).toHaveBeenCalledWith("/prev/dir/owner_y.pdf", expect.any(Uint8Array));
    // Le chemin fichier du mode single ne doit pas avoir été utilisé
    expect(writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining("single.pdf"),
      expect.anything()
    );
  });
});
