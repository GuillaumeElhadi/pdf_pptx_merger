import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { PDFDocument, PDFPage } from "pdf-lib";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Bridge } from "../services/bridge";
import type { AppStatus, MergeItem, PdfItem, SlideGroupItem } from "../types";

interface MergeStore {
  // ── PPTX state ────────────────────────────────────────────────────────────
  pptxPath: string | null;
  /** Path to the single merged PDF produced from the PPTX. */
  slidePdf: string | null;
  /** Total number of slides available (= pages in slidePdf). */
  slideCount: number;
  /** Slide indices already assigned to a group — cannot be reused. */
  usedSlideIndices: Set<number>;

  // ── Flat merge list ───────────────────────────────────────────────────────
  items: MergeItem[];

  // ── Status ────────────────────────────────────────────────────────────────
  status: AppStatus;
  statusMessage: string;
  lastOutputPath: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadPptx: () => Promise<void>;
  addPdfs: () => Promise<void>;
  addSlideGroup: (slideIndices: number[]) => void;
  updateSlideGroup: (id: string, slideIndices: number[]) => void;
  removeItem: (id: string) => void;
  reorderItems: (activeId: string, overId: string) => void;
  generate: () => Promise<void>;
  clearError: () => void;
}

export const useMergeStore = create<MergeStore>((set, get) => ({
  pptxPath: null,
  slidePdf: null,
  slideCount: 0,
  usedSlideIndices: new Set(),
  items: [],
  status: "idle",
  statusMessage: "Ready.",
  lastOutputPath: null,

  // ── loadPptx ─────────────────────────────────────────────────────────────
  loadPptx: async () => {
    const path = await Bridge.pickPptxFile();
    if (!path) return;

    const hasGroups = get().items.some((i) => i.type === "slide-group");
    if (hasGroups) {
      const ok = confirm(
        "Loading a new PPTX will remove all existing slide groups. Continue?"
      );
      if (!ok) return;
    }

    set({
      status: "converting",
      statusMessage: "Converting PPTX via PowerPoint…",
      pptxPath: path,
      items: get().items.filter((i) => i.type === "pdf"),
      usedSlideIndices: new Set(),
      slidePdf: null,
      slideCount: 0,
    });

    try {
      const mergedPdf = await Bridge.convertPptx(path);
      const count = await Bridge.getPdfPageCount(mergedPdf);
      set({
        slidePdf: mergedPdf,
        slideCount: count,
        status: "idle",
        statusMessage: `PPTX loaded — ${count} slide${count !== 1 ? "s" : ""} available.`,
      });
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
  addPdfs: async () => {
    const paths = await Bridge.pickPdfFiles();
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

  // ── addSlideGroup ─────────────────────────────────────────────────────────
  addSlideGroup: (slideIndices) => {
    if (slideIndices.length === 0) return;
    const sorted = [...slideIndices].sort((a, b) => a - b);
    const item: SlideGroupItem = { id: uuid(), type: "slide-group", slideIndices: sorted };

    set((s) => ({
      items: [...s.items, item],
      usedSlideIndices: new Set([...s.usedSlideIndices, ...sorted]),
      statusMessage: `Slide group added (${sorted.length} slide${sorted.length !== 1 ? "s" : ""}).`,
    }));
  },

  // ── updateSlideGroup ──────────────────────────────────────────────────────
  updateSlideGroup: (id, slideIndices) => {
    const sorted = [...slideIndices].sort((a, b) => a - b);
    set((s) => {
      const old = s.items.find((i) => i.id === id) as SlideGroupItem | undefined;
      const oldIndices = old?.slideIndices ?? [];

      const newUsed = new Set(s.usedSlideIndices);
      oldIndices.forEach((i) => newUsed.delete(i));
      sorted.forEach((i) => newUsed.add(i));

      return {
        items: s.items.map((item) =>
          item.id === id ? { ...item, slideIndices: sorted } : item
        ),
        usedSlideIndices: newUsed,
        statusMessage: "Slide group updated.",
      };
    });
  },

  // ── removeItem ────────────────────────────────────────────────────────────
  removeItem: (id) => {
    set((s) => {
      const target = s.items.find((i) => i.id === id);
      const newUsed = new Set(s.usedSlideIndices);
      if (target?.type === "slide-group") {
        target.slideIndices.forEach((i) => newUsed.delete(i));
      }
      return {
        items: s.items.filter((i) => i.id !== id),
        usedSlideIndices: newUsed,
      };
    });
  },

  // ── reorderItems ──────────────────────────────────────────────────────────
  reorderItems: (activeId, overId) => {
    set((s) => {
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

      // Cache loaded source documents to avoid re-reading large files
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
      const total = items.reduce(
        (n, item) =>
          item.type === "pdf" ? n + 1 : n + item.slideIndices.length,
        0
      );

      for (const item of items) {
        if (item.type === "pdf") {
          const doc = await loadDoc(item.pdfPath);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p: PDFPage) => merged.addPage(p));
          processed += 1;
        } else {
          if (!slidePdf) continue;
          const doc = await loadDoc(slidePdf);
          const pages = await merged.copyPages(doc, item.slideIndices);
          pages.forEach((p: PDFPage) => merged.addPage(p));
          processed += item.slideIndices.length;
        }
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
