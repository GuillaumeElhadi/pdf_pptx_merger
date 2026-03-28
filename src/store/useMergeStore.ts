import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { Bridge } from "../services/bridge";
import type { AppStatus, MergeItem, PdfItem, SlideGroupItem } from "../types";

interface MergeStore {
  // ── PPTX state ────────────────────────────────────────────────────────────
  pptxPath: string | null;
  /** One temp PDF path per slide (index = slide number, 0-based). */
  slidePdfs: string[];
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
  slidePdfs: [],
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
      // Remove all existing slide groups, keep PDFs
      items: get().items.filter((i) => i.type === "pdf"),
      usedSlideIndices: new Set(),
      slidePdfs: [],
    });

    try {
      const mergedPdf = await Bridge.convertPptx(path);
      const pages = await Bridge.splitPdfIntoPages(mergedPdf);
      set({
        slidePdfs: pages,
        status: "idle",
        statusMessage: `PPTX loaded — ${pages.length} slide${pages.length !== 1 ? "s" : ""} available.`,
      });
    } catch (e) {
      set({
        status: "error",
        statusMessage: String(e),
        pptxPath: null,
        slidePdfs: [],
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
    const { items, slidePdfs, lastOutputPath } = get();
    const hasPdf = items.some((i) => i.type === "pdf");
    if (!hasPdf) return;

    let outputPath = await Bridge.pickSaveLocation();
    // On macOS the replace-confirmation sheet can return null — fall back to last used path
    if (!outputPath) {
      if (lastOutputPath) {
        outputPath = lastOutputPath;
      } else {
        return;
      }
    }

    set({ status: "merging", statusMessage: "Resolving pages…" });

    try {
      // Build the flat ordered list of single-page PDF paths
      const pagePaths: string[] = [];

      for (const item of items) {
        if (item.type === "pdf") {
          // Pass the PDF directly — merger.rs handles multi-page documents
          pagePaths.push(item.pdfPath);
        } else {
          // Map each slide index to its pre-split temp PDF
          for (const idx of item.slideIndices) {
            if (slidePdfs[idx]) pagePaths.push(slidePdfs[idx]);
          }
        }
      }

      set({ statusMessage: `Merging ${pagePaths.length} pages…` });
      await Bridge.mergePdfs(pagePaths, outputPath);

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
