import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMergeStore } from "./useMergeStore";
import { Bridge } from "../services/bridge";
import type { PdfItem, SlideItem } from "../types";

const TEST_SOURCE_ID = "test-source";

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
  return { id, type: "slide", slideIndex, rotation: 0, pptxSourceId: TEST_SOURCE_ID };
}

function resetStore() {
  useMergeStore.setState({
    pptxSources: [],
    items: [],
    selectedIds: new Set(),
    status: "idle",
    statusMessage: "Prêt.",
    progress: null,
    lastOutputPath: null,
    ownersDetectionEnabled: false,
    rotationDetectionEnabled: false,
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
    expect(s.pptxSources).toHaveLength(0);
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

describe("useMergeStore — toggles de détection", () => {
  beforeEach(resetStore);

  it("démarre avec les deux toggles désactivés", () => {
    const s = useMergeStore.getState();
    expect(s.ownersDetectionEnabled).toBe(false);
    expect(s.rotationDetectionEnabled).toBe(false);
  });

  it("setOwnersDetectionEnabled met à jour le state", () => {
    useMergeStore.getState().setOwnersDetectionEnabled(true);
    expect(useMergeStore.getState().ownersDetectionEnabled).toBe(true);
  });

  it("setRotationDetectionEnabled met à jour le state", () => {
    useMergeStore.getState().setRotationDetectionEnabled(true);
    expect(useMergeStore.getState().rotationDetectionEnabled).toBe(true);
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

  it("les items sont dans le store dès que l'extraction commence", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    let itemCountWhenExtractionStarts = -1;
    vi.mocked(extractOwners).mockImplementation(async () => {
      itemCountWhenExtractionStarts = useMergeStore.getState().items.length;
      return { owners: [], pageOwners: new Map(), pageRotationCorrections: new Map() };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    expect(itemCountWhenExtractionStarts).toBe(1);
  });

  it("peuple owners une fois l'extraction terminée", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    const detected = [{ code: "0000001", name: "IMMO CARREFOUR" }];
    vi.mocked(extractOwners).mockResolvedValue({
      owners: detected,
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    const { items } = useMergeStore.getState();
    expect((items[0] as PdfItem).owners).toEqual(detected);
  });

  it("peuple pageOwners une fois l'extraction terminée", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    const pageOwnersMap = new Map([[1, { code: "0000001", name: "OWNER A" }]]);
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [{ code: "0000001", name: "OWNER A" }],
      pageOwners: pageOwnersMap,
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    const item = useMergeStore.getState().items[0] as PdfItem;
    expect(item.pageOwners).toEqual(pageOwnersMap);
  });

  it("laisse owners undefined et peuple ownersError si extractOwners lève une erreur", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    vi.mocked(extractOwners).mockRejectedValue(new Error("échec extraction"));
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    const item = useMergeStore.getState().items[0] as PdfItem;
    expect(item.owners).toBeUndefined();
    expect(item.ownersError).toMatch(/échec extraction/);
  });

  it("status est 'extracting' pendant l'extraction", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    let statusDuringExtraction: string | undefined;
    vi.mocked(extractOwners).mockImplementation(async () => {
      statusDuringExtraction = useMergeStore.getState().status;
      return { owners: [], pageOwners: new Map(), pageRotationCorrections: new Map() };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();
    expect(statusDuringExtraction).toBe("extracting");
  });

  it("les PDFs sont extraits séquentiellement dans l'ordre", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    const callOrder: string[] = [];
    vi.mocked(extractOwners).mockImplementation(async (path) => {
      callOrder.push(path as string);
      return { owners: [], pageOwners: new Map(), pageRotationCorrections: new Map() };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf"]);

    await useMergeStore.getState().addPdfs();
    expect(callOrder).toEqual(["/a.pdf", "/b.pdf", "/c.pdf"]);
  });

  it("status est 'idle' et progress est null après l'extraction complète", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf"]);

    await useMergeStore.getState().addPdfs();
    const { status, progress } = useMergeStore.getState();
    expect(status).toBe("idle");
    expect(progress).toBeNull();
  });

  it("l'extraction continue sur les PDFs suivants si l'un d'eux échoue", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    const detected = [{ code: "0000001", name: "OWNER A" }];
    vi.mocked(extractOwners)
      .mockResolvedValueOnce({
        owners: detected,
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
      })
      .mockRejectedValueOnce(new Error("fichier corrompu"))
      .mockResolvedValueOnce({
        owners: detected,
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
      });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf"]);

    await useMergeStore.getState().addPdfs();

    const { items, status, progress } = useMergeStore.getState();
    const pdfItems = items.filter((i) => i.type === "pdf") as import("../types").PdfItem[];

    expect(pdfItems[0].owners).toEqual(detected);
    expect(pdfItems[1].owners).toBeUndefined();
    expect(pdfItems[1].ownersError).toMatch(/fichier corrompu/);
    expect(pdfItems[2].owners).toEqual(detected);
    expect(status).toBe("idle");
    expect(progress).toBeNull();
  });

  it("n'appelle pas extractOwners quand les deux toggles sont désactivés (comportement par défaut)", async () => {
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    expect(extractOwners).not.toHaveBeenCalled();
    const { items, status, progress } = useMergeStore.getState();
    expect(items).toHaveLength(1);
    expect(status).toBe("idle");
    expect(progress).toBeNull();
  });

  it("appelle extractOwners avec detectOwners=true, detectRotation=false quand seul le toggle propriétaires est actif", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true, rotationDetectionEnabled: false });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: true,
      detectRotation: false,
    });
  });

  it("appelle extractOwners avec detectOwners=false, detectRotation=true quand seul le toggle rotation est actif", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: false, rotationDetectionEnabled: true });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: false,
      detectRotation: true,
    });
  });

  it("appelle extractOwners avec les deux flags à true quand les deux toggles sont actifs", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true, rotationDetectionEnabled: true });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: true,
      detectRotation: true,
    });
  });

  it("ne renseigne pas pageRotationCorrections quand seul le toggle propriétaires est actif", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true, rotationDetectionEnabled: false });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [{ code: "0000001", name: "OWNER A" }],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

    await useMergeStore.getState().addPdfs();

    const item = useMergeStore.getState().items[0] as PdfItem;
    expect(item.owners).toEqual([{ code: "0000001", name: "OWNER A" }]);
    expect(item.pageRotationCorrections).toBeUndefined();
  });
});

describe("useMergeStore — loadPptx", () => {
  beforeEach(resetStore);

  it("convertit le PPTX et crée un SlideItem par diapositive", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue("/deck.pptx");
    vi.mocked(Bridge.convertPptx).mockResolvedValue("/tmp/slides.pdf");
    vi.mocked(Bridge.getPdfPageCount).mockResolvedValue(3);

    await useMergeStore.getState().loadPptx();

    const { items, pptxSources, status } = useMergeStore.getState();
    expect(status).toBe("idle");
    expect(pptxSources).toHaveLength(1);
    expect(pptxSources[0].slidePdf).toBe("/tmp/slides.pdf");
    expect(pptxSources[0].slideCount).toBe(3);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.type === "slide")).toBe(true);
    expect(items.map((i) => (i as SlideItem).slideIndex)).toEqual([0, 1, 2]);
  });

  it("passe en status error si la conversion échoue", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue("/deck.pptx");
    vi.mocked(Bridge.convertPptx).mockRejectedValue(new Error("PowerPoint introuvable"));

    await useMergeStore.getState().loadPptx();

    const { status, pptxSources } = useMergeStore.getState();
    expect(status).toBe("error");
    expect(pptxSources).toHaveLength(0);
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

    await useMergeStore.getState().loadPptx();

    const { items } = useMergeStore.getState();
    expect(items.some((i) => i.id === "existant")).toBe(true);
    expect(items.filter((i) => i.type === "slide")).toHaveLength(2);
  });
});
