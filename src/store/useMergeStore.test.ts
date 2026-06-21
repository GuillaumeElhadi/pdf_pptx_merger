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
import type { ExtractionResult } from "../services/ownerExtractor";

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

const emptyFileMetric = () => ({ filePath: "/x.pdf", pageCount: 0, totalMs: 0, pages: [] });

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

  it("setOwnersDetectionEnabled(true) relance extractOwners sur les PDFs sans owners détectés", async () => {
    const untouched: PdfItem = { id: "a", type: "pdf", pdfPath: "/a.pdf", rotation: 0 };
    useMergeStore.setState({ items: [untouched] });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [{ code: "0000001", name: "OWNER A" }],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
      fileMetric: emptyFileMetric(),
    });

    useMergeStore.getState().setOwnersDetectionEnabled(true);
    await vi.waitFor(() => {
      expect((useMergeStore.getState().items[0] as PdfItem).owners).toBeDefined();
    });

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: true,
      detectRotation: false,
    });
  });

  it("setOwnersDetectionEnabled(true) ignore les PDFs déjà traités (owners défini)", async () => {
    const already: PdfItem = {
      id: "a",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      owners: [],
      pageOwners: new Map(),
    };
    useMergeStore.setState({ items: [already] });

    useMergeStore.getState().setOwnersDetectionEnabled(true);

    expect(extractOwners).not.toHaveBeenCalled();
  });

  it("setOwnersDetectionEnabled(true) ignore les PDFs déjà en échec (ownersError défini)", async () => {
    const failed: PdfItem = {
      id: "a",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      ownersError: "timeout",
    };
    useMergeStore.setState({ items: [failed] });

    useMergeStore.getState().setOwnersDetectionEnabled(true);

    expect(extractOwners).not.toHaveBeenCalled();
  });

  it("setRotationDetectionEnabled(true) relance extractOwners sur les PDFs sans correction de rotation détectée", async () => {
    const untouched: PdfItem = { id: "a", type: "pdf", pdfPath: "/a.pdf", rotation: 0 };
    useMergeStore.setState({ items: [untouched] });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map([[1, 90]]),
      fileMetric: emptyFileMetric(),
    });

    useMergeStore.getState().setRotationDetectionEnabled(true);
    await vi.waitFor(() => {
      expect((useMergeStore.getState().items[0] as PdfItem).pageRotationCorrections).toBeDefined();
    });

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: false,
      detectRotation: true,
    });
  });

  it("setRotationDetectionEnabled(true) relance extractOwners même si ownersError est défini (échec owners non lié à la rotation)", async () => {
    const ownersFailedButRotationPending: PdfItem = {
      id: "a",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      ownersError: "timeout",
    };
    useMergeStore.setState({ items: [ownersFailedButRotationPending] });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map([[1, 90]]),
      fileMetric: emptyFileMetric(),
    });

    useMergeStore.getState().setRotationDetectionEnabled(true);
    await vi.waitFor(() => {
      expect((useMergeStore.getState().items[0] as PdfItem).pageRotationCorrections).toBeDefined();
    });

    expect(extractOwners).toHaveBeenCalledWith("/a.pdf", {
      detectOwners: false,
      detectRotation: true,
    });
  });

  it("setRotationDetectionEnabled(true) ignore les PDFs déjà traités (pageRotationCorrections défini)", async () => {
    const already: PdfItem = {
      id: "a",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      pageRotationCorrections: new Map(),
    };
    useMergeStore.setState({ items: [already] });

    useMergeStore.getState().setRotationDetectionEnabled(true);

    expect(extractOwners).not.toHaveBeenCalled();
  });

  it("setOwnersDetectionEnabled(false) n'appelle pas extractOwners", () => {
    const untouched: PdfItem = { id: "a", type: "pdf", pdfPath: "/a.pdf", rotation: 0 };
    useMergeStore.setState({ items: [untouched], ownersDetectionEnabled: true });

    useMergeStore.getState().setOwnersDetectionEnabled(false);

    expect(extractOwners).not.toHaveBeenCalled();
  });

  it("sérialise deux activations de toggles en rafale : le 2e processPdfItems attend la fin du 1er", async () => {
    // "a" still needs owners-detection but already has its rotation determined,
    // so it's excluded from setRotationDetectionEnabled's pending filter.
    const ownersPending: PdfItem = {
      id: "a",
      type: "pdf",
      pdfPath: "/a.pdf",
      rotation: 0,
      pageRotationCorrections: new Map(),
    };
    // "b" still needs rotation-detection but already has its owners determined,
    // so it's excluded from setOwnersDetectionEnabled's pending filter.
    const rotationPending: PdfItem = {
      id: "b",
      type: "pdf",
      pdfPath: "/b.pdf",
      rotation: 0,
      owners: [],
      pageOwners: new Map(),
    };
    useMergeStore.setState({ items: [ownersPending, rotationPending] });

    let resolveFirst!: (value: ExtractionResult) => void;
    const firstCallPromise = new Promise<ExtractionResult>((resolve) => {
      resolveFirst = resolve;
    });

    const callOrder: string[] = [];
    vi.mocked(extractOwners).mockImplementation(async (pdfPath: string) => {
      callOrder.push(pdfPath);
      if (pdfPath === "/a.pdf") {
        return firstCallPromise;
      }
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
    });

    // Trigger two overlapping retroactive runs: owners-detection on item "a",
    // then immediately rotation-detection on item "b".
    useMergeStore.getState().setOwnersDetectionEnabled(true);
    useMergeStore.getState().setRotationDetectionEnabled(true);

    // Give microtasks a chance to run — only the first call should have fired so far,
    // because the second processPdfItems call is chained behind the first (still pending).
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toEqual(["/a.pdf"]);
    expect((useMergeStore.getState().items[1] as PdfItem).pageRotationCorrections).toBeUndefined();

    // Resolve the first extractOwners call — only now should the chain advance to item "b".
    resolveFirst({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
      fileMetric: emptyFileMetric(),
    });

    await vi.waitFor(() => {
      expect((useMergeStore.getState().items[1] as PdfItem).pageRotationCorrections).toBeDefined();
    });

    expect(callOrder).toEqual(["/a.pdf", "/b.pdf"]);
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
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
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
      fileMetric: emptyFileMetric(),
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
      fileMetric: emptyFileMetric(),
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
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
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
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf"]);

    await useMergeStore.getState().addPdfs();
    expect(callOrder).toEqual(["/a.pdf", "/b.pdf", "/c.pdf"]);
  });

  it("traite plusieurs PDFs avec une concurrence bornée (pas tout en séquentiel)", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });

    let active = 0;
    let maxActive = 0;
    const releasers: Array<() => void> = [];

    vi.mocked(extractOwners).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releasers.push(() => resolve()));
      active--;
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf", "/d.pdf"]);

    const addPdfsPromise = useMergeStore.getState().addPdfs();

    // Let microtasks settle so every initially-launched worker has started and is now
    // blocked on its own deferred promise.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(maxActive).toBeGreaterThan(1); // more than one file in flight at once
    expect(maxActive).toBeLessThan(4); // but not all 4 at once — concurrency is bounded

    // Drain all pending extractions in rounds so addPdfs() can resolve, regardless of
    // how many workers are active per round.
    for (let round = 0; round < 4; round++) {
      const toRelease = releasers.splice(0, releasers.length);
      toRelease.forEach((r) => r());
      await Promise.resolve();
      await Promise.resolve();
    }

    await addPdfsPromise;
    expect(useMergeStore.getState().items).toHaveLength(4);
  });

  it("status est 'idle' et progress est null après l'extraction complète", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true });
    vi.mocked(extractOwners).mockResolvedValue({
      owners: [],
      pageOwners: new Map(),
      pageRotationCorrections: new Map(),
      fileMetric: emptyFileMetric(),
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
        fileMetric: emptyFileMetric(),
      })
      .mockRejectedValueOnce(new Error("fichier corrompu"))
      .mockResolvedValueOnce({
        owners: detected,
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
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
      fileMetric: emptyFileMetric(),
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
      fileMetric: emptyFileMetric(),
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
      fileMetric: emptyFileMetric(),
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
      fileMetric: emptyFileMetric(),
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
