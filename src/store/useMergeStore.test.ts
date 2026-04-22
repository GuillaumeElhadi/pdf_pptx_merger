import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMergeStore } from "./useMergeStore";
import { Bridge } from "../services/bridge";
import type { ExtractionResult } from "../services/ownerExtractor";
import type { PdfItem, SlideItem } from "../types";

// Mock extractOwners so it doesn't load real PDFs
vi.mock("../services/ownerExtractor", () => ({
  extractOwners: vi.fn().mockResolvedValue({ owners: [], pageOwners: new Map() }),
}));

// Mock Bridge au niveau module — isole le store des appels natifs Tauri
vi.mock("../services/bridge", () => ({
  Bridge: {
    pickPptxFile: vi.fn(),
    pickPdfFiles: vi.fn(),
    convertPptx: vi.fn(),
    getPdfPageCount: vi.fn(),
    pickSaveLocation: vi.fn(),
    getTempDir: vi.fn(),
    getGoogleDrivePath: vi.fn(),
    extractPdfPage: vi.fn(),
    openFile: vi.fn(),
  },
}));

import { extractOwners } from "../services/ownerExtractor";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePdf(id: string, path = `/files/${id}.pdf`): PdfItem {
  return { id, type: "pdf", pdfPath: path, rotation: 0 };
}

function makeSlide(id: string, slideIndex = 0): SlideItem {
  return { id, type: "slide", slideIndex, rotation: 0 };
}

function resetStore() {
  useMergeStore.setState({
    pptxPath: null,
    slidePdf: null,
    slideCount: 0,
    items: [],
    selectedIds: new Set(),
    status: "idle",
    statusMessage: "Prêt.",
    progress: null,
    lastOutputPath: null,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useMergeStore — état initial", () => {
  it("démarre avec un état vide et idle", () => {
    resetStore();
    const s = useMergeStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.status).toBe("idle");
    expect(s.progress).toBeNull();
    expect(s.pptxPath).toBeNull();
    expect(s.selectedIds.size).toBe(0);
  });
});

describe("useMergeStore — removeItem", () => {
  beforeEach(resetStore);

  it("retire l'élément de la liste", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b")] });
    useMergeStore.getState().removeItem("a");
    const { items } = useMergeStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("b");
  });

  it("retire aussi l'id de la sélection", () => {
    useMergeStore.setState({
      items: [makePdf("a"), makePdf("b")],
      selectedIds: new Set(["a", "b"]),
    });
    useMergeStore.getState().removeItem("a");
    const { selectedIds } = useMergeStore.getState();
    expect(selectedIds.has("a")).toBe(false);
    expect(selectedIds.has("b")).toBe(true);
  });

  it("ne plante pas sur un id inexistant", () => {
    useMergeStore.setState({ items: [makePdf("a")] });
    expect(() => useMergeStore.getState().removeItem("inexistant")).not.toThrow();
    expect(useMergeStore.getState().items).toHaveLength(1);
  });
});

describe("useMergeStore — reorderItems", () => {
  beforeEach(resetStore);

  it("déplace un item unique vers une nouvelle position", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b"), makePdf("c")] });
    useMergeStore.getState().reorderItems("a", "c");
    const ids = useMergeStore.getState().items.map((i) => i.id);
    // "a" doit être après "b" et "c"
    expect(ids).toEqual(["b", "c", "a"]);
  });

  it("ne change rien si activeId et overId sont identiques", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b")] });
    useMergeStore.getState().reorderItems("a", "a");
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("déplace une sélection multiple en bloc (vers le bas)", () => {
    useMergeStore.setState({
      items: [makePdf("a"), makePdf("b"), makePdf("c"), makePdf("d")],
    });
    // Sélection : a + b, déplacés après d
    useMergeStore.getState().reorderItems("a", "d", new Set(["a", "b"]));
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["c", "d", "a", "b"]);
  });

  it("déplace un item unique vers le haut", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b"), makePdf("c")] });
    // Déplace "c" au-dessus de "a"
    useMergeStore.getState().reorderItems("c", "a");
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("déplace une sélection multiple vers le haut (draggingDown = false)", () => {
    useMergeStore.setState({
      items: [makePdf("a"), makePdf("b"), makePdf("c"), makePdf("d")],
    });
    // Sélection : c + d, déplacés avant a
    useMergeStore.getState().reorderItems("c", "a", new Set(["c", "d"]));
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["c", "d", "a", "b"]);
  });

  it("overInOthers = -1 : over est dans la sélection → bloc placé en fin de liste", () => {
    useMergeStore.setState({
      items: [makePdf("a"), makePdf("b"), makePdf("c"), makePdf("d")],
    });
    // b et c sont sélectionnés, l'over est c (lui-même dans la sélection)
    useMergeStore.getState().reorderItems("b", "c", new Set(["b", "c"]));
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "d", "b", "c"]);
  });

  it("ne change rien si activeId est introuvable", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b")] });
    useMergeStore.getState().reorderItems("inexistant", "b");
    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("useMergeStore — rotateItems", () => {
  beforeEach(resetStore);

  it("applique une rotation de +90° à l'item ciblé", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b")] });
    useMergeStore.getState().rotateItems(["a"]);
    const { items } = useMergeStore.getState();
    expect(items.find((i) => i.id === "a")!.rotation).toBe(90);
    expect(items.find((i) => i.id === "b")!.rotation).toBe(0);
  });

  it("boucle de 270° → 0°", () => {
    useMergeStore.setState({
      items: [{ ...makePdf("a"), rotation: 270 }],
    });
    useMergeStore.getState().rotateItems(["a"]);
    expect(useMergeStore.getState().items[0].rotation).toBe(0);
  });

  it("applique la rotation à plusieurs items", () => {
    useMergeStore.setState({
      items: [makePdf("a"), makeSlide("b"), makePdf("c")],
    });
    useMergeStore.getState().rotateItems(["a", "b"]);
    const { items } = useMergeStore.getState();
    expect(items.find((i) => i.id === "a")!.rotation).toBe(90);
    expect(items.find((i) => i.id === "b")!.rotation).toBe(90);
    expect(items.find((i) => i.id === "c")!.rotation).toBe(0);
  });
});

describe("useMergeStore — clearError", () => {
  beforeEach(resetStore);

  it("repasse à idle et efface le message d'erreur", () => {
    useMergeStore.setState({ status: "error", statusMessage: "Quelque chose a planté" });
    useMergeStore.getState().clearError();
    const { status, statusMessage } = useMergeStore.getState();
    expect(status).toBe("idle");
    expect(statusMessage).toBe("Prêt.");
  });
});

describe("useMergeStore — addPdfs", () => {
  beforeEach(resetStore);

  it("ajoute les PDFs sélectionnés à la liste", async () => {
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf"]);
    await useMergeStore.getState().addPdfs();
    const { items } = useMergeStore.getState();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "pdf", pdfPath: "/a.pdf", rotation: 0 });
    expect(items[1]).toMatchObject({ type: "pdf", pdfPath: "/b.pdf", rotation: 0 });
  });

  it("ne change pas l'état si l'utilisateur annule (null)", async () => {
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(null);
    await useMergeStore.getState().addPdfs();
    expect(useMergeStore.getState().items).toHaveLength(0);
  });

  it("ne change pas l'état si l'utilisateur annule (tableau vide)", async () => {
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue([]);
    await useMergeStore.getState().addPdfs();
    expect(useMergeStore.getState().items).toHaveLength(0);
  });

  it("ajoute les PDFs à la suite de ceux déjà présents", async () => {
    useMergeStore.setState({ items: [makePdf("existant")] });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/nouveau.pdf"]);
    await useMergeStore.getState().addPdfs();
    expect(useMergeStore.getState().items).toHaveLength(2);
  });

  it("les items apparaissent immédiatement (owners undefined avant extraction)", async () => {
    // extractOwners ne se résout pas immédiatement — on vérifie l'état synchrone
    let resolveExtraction!: (v: ExtractionResult) => void;
    vi.mocked(extractOwners).mockReturnValue(
      new Promise((r) => {
        resolveExtraction = r;
      })
    );
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    // Items are in the store, owners not yet set
    const { items } = useMergeStore.getState();
    expect(items).toHaveLength(1);
    expect((items[0] as PdfItem).owners).toBeUndefined();

    // Let extraction finish
    resolveExtraction({ owners: [], pageOwners: new Map() });
    await Promise.resolve();
  });

  it("peuple owners une fois l'extraction terminée", async () => {
    const detected = [{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }];
    vi.mocked(extractOwners).mockResolvedValue({ owners: detected, pageOwners: new Map() });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    // Allow the background microtask to settle
    await Promise.resolve();
    await Promise.resolve();

    const { items } = useMergeStore.getState();
    expect((items[0] as PdfItem).owners).toEqual(detected);
  });

  it("peuple pageOwners une fois l'extraction terminée", async () => {
    const pageOwnersMap = new Map([[1, { code: "0000001", name: "OWNER A" }]]);
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [{ code: "0000001", name: "OWNER A" }],
      pageOwners: pageOwnersMap,
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    await Promise.resolve();
    await Promise.resolve();

    const item = useMergeStore.getState().items[0] as PdfItem;
    expect(item.pageOwners).toEqual(pageOwnersMap);
  });

  it("laisse owners undefined et peuple ownersError si extractOwners lève une erreur", async () => {
    vi.mocked(extractOwners).mockRejectedValue(new Error("échec extraction"));
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    await Promise.resolve();
    await Promise.resolve();

    const item = useMergeStore.getState().items[0] as PdfItem;
    expect(item.owners).toBeUndefined();
    expect(item.ownersError).toMatch(/échec extraction/);
  });
});

describe("useMergeStore — loadPptx", () => {
  beforeEach(resetStore);

  it("convertit le PPTX et crée un SlideItem par diapositive", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue("/deck.pptx");
    vi.mocked(Bridge.convertPptx).mockResolvedValue("/tmp/slides.pdf");
    vi.mocked(Bridge.getPdfPageCount).mockResolvedValue(3);

    await useMergeStore.getState().loadPptx();

    const { items, slidePdf, slideCount, status } = useMergeStore.getState();
    expect(status).toBe("idle");
    expect(slidePdf).toBe("/tmp/slides.pdf");
    expect(slideCount).toBe(3);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.type === "slide")).toBe(true);
    expect(items.map((i) => (i as SlideItem).slideIndex)).toEqual([0, 1, 2]);
  });

  it("passe en status error si la conversion échoue", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue("/deck.pptx");
    vi.mocked(Bridge.convertPptx).mockRejectedValue(new Error("PowerPoint introuvable"));

    await useMergeStore.getState().loadPptx();

    const { status, pptxPath, slidePdf } = useMergeStore.getState();
    expect(status).toBe("error");
    expect(pptxPath).toBeNull();
    expect(slidePdf).toBeNull();
  });

  it("ne fait rien si l'utilisateur annule la sélection de fichier", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue(null);
    await useMergeStore.getState().loadPptx();
    expect(Bridge.convertPptx).not.toHaveBeenCalled();
    expect(useMergeStore.getState().status).toBe("idle");
  });

  it("conserve les PDFs existants lors du rechargement d'un PPTX", async () => {
    const pdfExistant = makePdf("existant");
    useMergeStore.setState({ items: [pdfExistant] });

    vi.mocked(Bridge.pickPptxFile).mockResolvedValue("/nouveau.pptx");
    vi.mocked(Bridge.convertPptx).mockResolvedValue("/tmp/slides.pdf");
    vi.mocked(Bridge.getPdfPageCount).mockResolvedValue(2);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await useMergeStore.getState().loadPptx();

    const { items } = useMergeStore.getState();
    expect(items.some((i) => i.id === "existant")).toBe(true);
    expect(items.filter((i) => i.type === "slide")).toHaveLength(2);
  });
});
