import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { PDFDocument, PDFPage, degrees } from "pdf-lib";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Bridge } from "../services/bridge";
import { strings } from "../strings";
import { logger } from "../utils/logger";
import type { AppStatus, MergeItem, PdfItem, Rotation, SlideItem } from "../types";

interface MergeStore {
  // ── PPTX state ────────────────────────────────────────────────────────────
  pptxPath: string | null;
  slidePdf: string | null;
  slideCount: number;

  // ── Flat merge list ───────────────────────────────────────────────────────
  items: MergeItem[];

  // ── Selection (lifted here so the banner can live outside the scroll area) ─
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  clearSelection: () => void;

  // ── Status ────────────────────────────────────────────────────────────────
  status: AppStatus;
  statusMessage: string;
  progress: number | null;
  lastOutputPath: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadPptx: (defaultPath?: string) => Promise<void>;
  addPdfs: (defaultPath?: string) => Promise<void>;
  removeItem: (id: string) => void;
  reorderItems: (activeId: string, overId: string, selectedIds?: Set<string>) => void;
  rotateItems: (ids: string[]) => void;
  generate: () => Promise<void>;
  clearError: () => void;
}

export const useMergeStore = create<MergeStore>((set, get) => ({
  pptxPath: null,
  slidePdf: null,
  slideCount: 0,
  items: [],
  selectedIds: new Set(),
  status: "idle",
  statusMessage: strings.status.ready,
  progress: null,
  lastOutputPath: null,

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),

  // ── loadPptx ─────────────────────────────────────────────────────────────
  loadPptx: async (defaultPath?: string) => {
    const path = await Bridge.pickPptxFile(defaultPath);
    if (!path) {
      logger.action("loadPptx:cancelled");
      return;
    }

    const hasSlides = get().items.some((i) => i.type === "slide");
    if (hasSlides) {
      const ok = confirm(strings.confirm.replacePptx);
      if (!ok) {
        logger.action("loadPptx:replace-declined");
        return;
      }
    }

    logger.action("loadPptx", { path });

    set({
      status: "converting",
      statusMessage: strings.status.converting,
      pptxPath: path,
      items: get().items.filter((i) => i.type === "pdf"),
      selectedIds: new Set(),
      slidePdf: null,
      slideCount: 0,
    });

    try {
      const mergedPdf = await Bridge.convertPptx(path);
      const count = await Bridge.getPdfPageCount(mergedPdf);

      const slideItems: SlideItem[] = Array.from({ length: count }, (_, i) => ({
        id: uuid(),
        type: "slide",
        slideIndex: i,
        rotation: 0,
      }));

      set((s) => ({
        slidePdf: mergedPdf,
        slideCount: count,
        items: [...s.items, ...slideItems],
        status: "idle",
        statusMessage: strings.status.pptxLoaded(count),
      }));
      logger.info("loadPptx", `OK — ${count} slides`);
    } catch (e) {
      logger.error("loadPptx", e);
      set({
        status: "error",
        statusMessage: String(e),
        pptxPath: null,
        slidePdf: null,
        slideCount: 0,
      });
    }
  },

  // ── addPdfs ──────────────────────────────────────────────────────────────
  addPdfs: async (defaultPath?: string) => {
    const paths = await Bridge.pickPdfFiles(defaultPath);
    if (!paths || paths.length === 0) {
      logger.action("addPdfs:cancelled");
      return;
    }

    logger.action("addPdfs", { count: paths.length, files: paths.map((p) => p.split(/[\\/]/).pop()) });

    const newItems: PdfItem[] = paths.map((p) => ({
      id: uuid(),
      type: "pdf",
      pdfPath: p,
      rotation: 0,
    }));

    set((s) => ({
      items: [...s.items, ...newItems],
      statusMessage: strings.status.pdfsAdded(newItems.length),
    }));
  },

  // ── removeItem ────────────────────────────────────────────────────────────
  removeItem: (id) => {
    const item = get().items.find((i) => i.id === id);
    logger.action("removeItem", { id, type: item?.type });
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedIds: new Set([...s.selectedIds].filter((sid) => sid !== id)),
    }));
  },

  // ── reorderItems ──────────────────────────────────────────────────────────
  reorderItems: (activeId, overId, selectedIds?) => {
    set((s) => {
      if (selectedIds && selectedIds.size > 1 && selectedIds.has(activeId)) {
        const oldIndex = s.items.findIndex((i) => i.id === activeId);
        const newIndex = s.items.findIndex((i) => i.id === overId);
        const draggingDown = newIndex > oldIndex;

        const selected = s.items.filter((i) => selectedIds.has(i.id));
        const others = s.items.filter((i) => !selectedIds.has(i.id));
        const overInOthers = others.findIndex((i) => i.id === overId);

        let pos: number;
        if (overInOthers === -1) {
          pos = others.length;
        } else if (draggingDown) {
          pos = overInOthers + 1;
        } else {
          pos = overInOthers;
        }

        return { items: [...others.slice(0, pos), ...selected, ...others.slice(pos)] };
      }
      const oldIndex = s.items.findIndex((i) => i.id === activeId);
      const newIndex = s.items.findIndex((i) => i.id === overId);
      if (oldIndex === -1 || newIndex === -1) return s;
      return { items: arrayMove(s.items, oldIndex, newIndex) };
    });
  },

  // ── rotateItems ───────────────────────────────────────────────────────────
  rotateItems: (ids) => {
    logger.action("rotateItems", { count: ids.length, ids });
    const idSet = new Set(ids);
    set((s) => ({
      items: s.items.map((item) => {
        if (!idSet.has(item.id)) return item;
        const next = ((item.rotation + 90) % 360) as Rotation;
        return { ...item, rotation: next };
      }),
    }));
  },

  // ── generate ─────────────────────────────────────────────────────────────
  generate: async () => {
    const { items, slidePdf, lastOutputPath } = get();
    const hasPdf = items.some((i) => i.type === "pdf");
    if (!hasPdf) return;

    let outputPath = await Bridge.pickSaveLocation();
    if (!outputPath) {
      if (lastOutputPath) {
        const reuse = confirm(strings.confirm.reuseOutput(lastOutputPath));
        if (!reuse) return;
        outputPath = lastOutputPath;
      } else {
        return;
      }
    }

    logger.action("generate", { itemCount: items.length });
    set({ status: "merging", statusMessage: strings.status.preparingMerge, progress: 0 });

    try {
      const merged = await PDFDocument.create();

      const docCache = new Map<string, PDFDocument>();
      const loadDoc = async (path: string): Promise<PDFDocument> => {
        const cached = docCache.get(path);
        if (cached) return cached;
        const res = await fetch(convertFileSrc(path));
        const bytes = await res.arrayBuffer();
        const doc = await PDFDocument.load(bytes);
        docCache.set(path, doc);
        return doc;
      };

      // Pré-chargement et comptage du total de pages réelles
      let totalPages = 0;
      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadDoc(item.pdfPath);
          totalPages += doc.getPageCount();
        } else {
          totalPages += 1;
        }
      }
      if (slidePdf && items.some((i) => i.type === "slide")) {
        await loadDoc(slidePdf);
      }

      let processedPages = 0;

      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadDoc(item.pdfPath);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p: PDFPage) => {
            if (item.rotation !== 0) {
              p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
            }
            merged.addPage(p);
          });
          processedPages += doc.getPageCount();
        } else {
          if (!slidePdf) continue;
          const doc = await loadDoc(slidePdf);
          const [page] = await merged.copyPages(doc, [item.slideIndex]);
          if (item.rotation !== 0) {
            page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
          }
          merged.addPage(page);
          processedPages += 1;
        }
        set({
          statusMessage: strings.status.merging(processedPages, totalPages),
          progress: processedPages / totalPages,
        });
      }

      const bytes = await merged.save();
      await writeFile(outputPath, bytes);

      logger.info("generate", `PDF saved → ${outputPath}`);
      set({
        status: "idle",
        statusMessage: strings.status.pdfSaved(outputPath),
        progress: null,
        lastOutputPath: outputPath,
      });
    } catch (e) {
      logger.error("generate", e);
      set({ status: "error", statusMessage: String(e), progress: null });
    }
  },

  // ── clearError ────────────────────────────────────────────────────────────
  clearError: () => set({ status: "idle", statusMessage: strings.status.ready }),
}));
