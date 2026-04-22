import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { PDFDocument, PDFPage, degrees } from "pdf-lib";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Bridge } from "../services/bridge";
import { extractOwners, type OwnerInfo } from "../services/ownerExtractor";
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

    // Enrich each new PDF with owner info in the background (non-blocking)
    newItems.forEach(async (item) => {
      const owners = await extractOwners(item.pdfPath).catch((): OwnerInfo[] => []);
      set((s) => ({
        items: s.items.map((i) => (i.id === item.id ? { ...i, owners } : i)),
      }));
    });
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
  /**
   * Moves one or more items in the merge list when a drag ends.
   *
   * Single-item drag: delegates to @dnd-kit/sortable's `arrayMove`.
   *
   * Multi-select drag (selectedIds.size > 1 and activeId is in the selection):
   *   1. Split the list into `selected` (the dragged bloc) and `others`.
   *   2. Find where the drop target (`overId`) sits in `others`:
   *      - If `overId` is itself selected (overInOthers === -1), place the
   *        bloc at the end of the list.
   *      - If dragging downward, insert the bloc *after* the target in `others`.
   *      - If dragging upward, insert the bloc *before* the target.
   *   3. Reconstruct the list as [others before pos] + selected + [others after pos].
   */
  reorderItems: (activeId, overId, selectedIds?) => {
    set((s) => {
      if (selectedIds && selectedIds.size > 1 && selectedIds.has(activeId)) {
        const oldIndex = s.items.findIndex((i) => i.id === activeId);
        const newIndex = s.items.findIndex((i) => i.id === overId);
        // draggingDown determines insertion side relative to the target in `others`
        const draggingDown = newIndex > oldIndex;

        const selected = s.items.filter((i) => selectedIds.has(i.id));
        const others = s.items.filter((i) => !selectedIds.has(i.id));
        const overInOthers = others.findIndex((i) => i.id === overId);

        let pos: number;
        if (overInOthers === -1) {
          // Drop target is inside the selection — place bloc at the end
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
  /**
   * Produces the final merged PDF from the current `items` list.
   *
   * Two-pass strategy:
   *   Pass 1 (preload) — iterates `items` to load every source PDF into
   *   `pdfDocumentCache` and tally `totalPages` for the progress bar.
   *   The slide PDF (if present) is also preloaded here so every `copyPages`
   *   call in pass 2 is a synchronous cache hit.
   *
   *   Pass 2 (merge) — iterates `items` again, copying pages into `merged`
   *   and applying any rotation. Progress is updated after each item.
   *
   * Each unique file path is fetched exactly once — `loadOrCacheDoc` returns
   * the cached `PDFDocument` on subsequent calls.
   */
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

      // Keyed by file path — each source PDF is loaded from disk exactly once
      const pdfDocumentCache = new Map<string, PDFDocument>();
      const loadOrCacheDoc = async (path: string): Promise<PDFDocument> => {
        const cached = pdfDocumentCache.get(path);
        if (cached) return cached;
        const res = await fetch(convertFileSrc(path));
        const bytes = await res.arrayBuffer();
        const doc = await PDFDocument.load(bytes);
        pdfDocumentCache.set(path, doc);
        return doc;
      };

      // Pass 1: preload all source documents and count total pages for progress
      let totalPages = 0;
      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadOrCacheDoc(item.pdfPath);
          totalPages += doc.getPageCount();
        } else {
          totalPages += 1;
        }
      }
      if (slidePdf && items.some((i) => i.type === "slide")) {
        await loadOrCacheDoc(slidePdf);
      }

      // Pass 2: copy pages into the merged document, applying rotations
      let mergedPageCount = 0;

      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadOrCacheDoc(item.pdfPath);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p: PDFPage) => {
            if (item.rotation !== 0) {
              p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
            }
            merged.addPage(p);
          });
          mergedPageCount += doc.getPageCount();
        } else {
          if (!slidePdf) continue;
          const doc = await loadOrCacheDoc(slidePdf);
          const [page] = await merged.copyPages(doc, [item.slideIndex]);
          if (item.rotation !== 0) {
            page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
          }
          merged.addPage(page);
          mergedPageCount += 1;
        }
        set({
          statusMessage: strings.status.merging(mergedPageCount, totalPages),
          progress: mergedPageCount / totalPages,
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
