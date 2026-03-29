import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { PDFDocument, PDFPage } from "pdf-lib";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Bridge } from "../services/bridge";
import type { AppStatus, MergeItem, PdfItem, SlideItem } from "../types";

interface MergeStore {
  // ── PPTX state ────────────────────────────────────────────────────────────
  pptxPath: string | null;
  slidePdf: string | null;
  slideCount: number;

  // ── Flat merge list ───────────────────────────────────────────────────────
  items: MergeItem[];

  // ── Selection (lifted here so the banner can live outside the scroll area) ─
  selectedSlideIds: Set<string>;
  setSelectedSlideIds: (ids: Set<string>) => void;
  clearSelection: () => void;

  // ── Status ────────────────────────────────────────────────────────────────
  status: AppStatus;
  statusMessage: string;
  lastOutputPath: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadPptx: (defaultPath?: string) => Promise<void>;
  addPdfs: (defaultPath?: string) => Promise<void>;
  removeItem: (id: string) => void;
  reorderItems: (activeId: string, overId: string, selectedIds?: Set<string>) => void;
  generate: () => Promise<void>;
  clearError: () => void;
}

export const useMergeStore = create<MergeStore>((set, get) => ({
  pptxPath: null,
  slidePdf: null,
  slideCount: 0,
  items: [],
  selectedSlideIds: new Set(),
  status: "idle",
  statusMessage: "Ready.",
  lastOutputPath: null,

  setSelectedSlideIds: (ids) => set({ selectedSlideIds: ids }),
  clearSelection: () => set({ selectedSlideIds: new Set() }),

  // ── loadPptx ─────────────────────────────────────────────────────────────
  loadPptx: async (defaultPath?: string) => {
    const path = await Bridge.pickPptxFile(defaultPath);
    if (!path) return;

    const hasSlides = get().items.some((i) => i.type === "slide");
    if (hasSlides) {
      const ok = confirm(
        "Loading a new PPTX will replace all existing slides. Continue?"
      );
      if (!ok) return;
    }

    set({
      status: "converting",
      statusMessage: "Converting PPTX via PowerPoint…",
      pptxPath: path,
      items: get().items.filter((i) => i.type === "pdf"),
      selectedSlideIds: new Set(),
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
      }));

      set((s) => ({
        slidePdf: mergedPdf,
        slideCount: count,
        items: [...s.items, ...slideItems],
        status: "idle",
        statusMessage: `PPTX loaded — ${count} slide${count !== 1 ? "s" : ""} available.`,
      }));
    } catch (e) {
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
    if (!paths || paths.length === 0) return;

    const newItems: PdfItem[] = paths.map((p) => ({
      id: uuid(),
      type: "pdf",
      pdfPath: p,
    }));

    set((s) => ({
      items: [...s.items, ...newItems],
      statusMessage: `Added ${newItems.length} PDF${newItems.length !== 1 ? "s" : ""}.`,
    }));
  },

  // ── removeItem ────────────────────────────────────────────────────────────
  removeItem: (id) => {
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedSlideIds: new Set([...s.selectedSlideIds].filter((sid) => sid !== id)),
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

  // ── generate ─────────────────────────────────────────────────────────────
  generate: async () => {
    const { items, slidePdf, lastOutputPath } = get();
    const hasPdf = items.some((i) => i.type === "pdf");
    if (!hasPdf) return;

    let outputPath = await Bridge.pickSaveLocation();
    if (!outputPath) {
      if (lastOutputPath) {
        const reuse = confirm(`Re-use previous output file?\n${lastOutputPath}`);
        if (!reuse) return;
        outputPath = lastOutputPath;
      } else {
        return;
      }
    }

    set({ status: "merging", statusMessage: "Preparing merge…" });

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

      let processed = 0;
      const total = items.length;

      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadDoc(item.pdfPath);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p: PDFPage) => merged.addPage(p));
        } else {
          if (!slidePdf) continue;
          const doc = await loadDoc(slidePdf);
          const [page] = await merged.copyPages(doc, [item.slideIndex]);
          merged.addPage(page);
        }
        processed += 1;
        set({ statusMessage: `Merging… ${processed}/${total}` });
      }

      const bytes = await merged.save();
      await writeFile(outputPath, bytes);

      set({
        status: "idle",
        statusMessage: `✓ PDF saved: ${outputPath}`,
        lastOutputPath: outputPath,
      });
    } catch (e) {
      set({ status: "error", statusMessage: String(e) });
    }
  },

  // ── clearError ────────────────────────────────────────────────────────────
  clearError: () => set({ status: "idle", statusMessage: "Ready." }),
}));
