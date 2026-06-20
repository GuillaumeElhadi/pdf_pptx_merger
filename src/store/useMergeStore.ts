import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
import { PDFDocument, PDFPage, degrees } from "pdf-lib";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Bridge } from "../services/bridge";
import { extractOwners } from "../services/ownerExtractor";
import { strings } from "../strings";
import { logger } from "../utils/logger";
import type {
  AppStatus,
  MergeItem,
  OwnerInfo,
  PdfItem,
  PptxSource,
  Rotation,
  SlideItem,
} from "../types";

const PPTX_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#06b6d4", "#ef4444"];

/**
 * Applies the page-1 rotation correction to every page of a PDF and saves the
 * result to the app temp directory.  All pages share the same orientation (the
 * user confirmed that page 1 is representative for the whole document), so the
 * correction detected for page 1 is applied uniformly.
 *
 * Returns the path of the corrected temp file, or null when no correction is needed.
 */
async function bakeRotationCorrections(
  pdfPath: string,
  pageRotationCorrections: Map<number, Rotation>,
  tempDir: string
): Promise<string | null> {
  const correction = pageRotationCorrections.get(1) ?? 0;
  if (correction === 0) return null;

  const res = await fetch(convertFileSrc(pdfPath));
  const bytes = await res.arrayBuffer();
  const doc = await PDFDocument.load(bytes);

  for (const page of doc.getPages()) {
    const newAngle = (page.getRotation().angle + correction) % 360;
    page.setRotation(degrees(newAngle));
  }

  const saved = await doc.save();
  const filename = pdfPath.split(/[\\/]/).pop() ?? "rotated.pdf";
  const normalizedDir = tempDir.replace(/[/\\]$/, "");
  const sep = normalizedDir.includes("/") ? "/" : "\\";
  const tempPath = `${normalizedDir}${sep}rotated_${Date.now()}_${filename}`;
  await writeFile(tempPath, new Uint8Array(saved));

  return tempPath;
}

function ownerToSnakeCase(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface MergeStore {
  // ── PPTX state ────────────────────────────────────────────────────────────
  pptxSources: PptxSource[];

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
  lastOutputDir: string | null;

  // ── Detection toggles ─────────────────────────────────────────────────────
  ownersDetectionEnabled: boolean;
  rotationDetectionEnabled: boolean;
  setOwnersDetectionEnabled: (enabled: boolean) => void;
  setRotationDetectionEnabled: (enabled: boolean) => void;

  // ── Actions ───────────────────────────────────────────────────────────────
  loadPptx: (defaultPath?: string) => Promise<void>;
  addPdfs: (defaultPath?: string) => Promise<void>;
  removeItem: (id: string) => void;
  reorderItems: (activeId: string, overId: string, selectedIds?: Set<string>) => void;
  rotateItems: (ids: string[]) => void;
  generate: () => Promise<void>;
  clearError: () => void;
}

export const useMergeStore = create<MergeStore>((set, get) => {
  /**
   * Runs owner-detection and/or rotation-detection on `targetItems` according to `options`,
   * updating the store's items/status/progress as it goes. Shared by `addPdfs` (new items)
   * and the detection-toggle setters (retroactive runs on existing items, added in Task 4).
   * Only the fields for enabled features are written back, so a partial run (e.g.
   * detectRotation-only) never clobbers data from a previous run of the other feature.
   */
  async function processPdfItems(
    targetItems: PdfItem[],
    options: { detectOwners: boolean; detectRotation: boolean }
  ) {
    if (targetItems.length === 0) return;

    set({
      status: "extracting",
      statusMessage: strings.status.extractingOwners(0, targetItems.length),
      progress: 0,
    });

    const tempDir = await Bridge.getTempDir();

    let done = 0;
    let failedCount = 0;
    const allFoundOwners = new Map<string, OwnerInfo>();
    try {
      for (const item of targetItems) {
        const filename = item.pdfPath.split(/[\\/]/).pop() ?? item.pdfPath;
        logger.info(
          "processPdfItems:extractOwners",
          `start ${done + 1}/${targetItems.length} — ${filename}`
        );
        try {
          const { owners, pageOwners, pageRotationCorrections } = await extractOwners(
            item.pdfPath,
            options
          );
          done++;
          for (const o of owners) {
            if (!allFoundOwners.has(o.name)) allFoundOwners.set(o.name, o);
          }

          let effectivePdfPath = item.pdfPath;
          let autoRotated = item.autoRotated ?? false;
          if (options.detectRotation && pageRotationCorrections.size > 0) {
            try {
              const correctedPath = await bakeRotationCorrections(
                item.pdfPath,
                pageRotationCorrections,
                tempDir
              );
              if (correctedPath) {
                effectivePdfPath = correctedPath;
                autoRotated = true;
                logger.info("processPdfItems:bakeRotation", `rotated temp file → ${correctedPath}`);
              }
            } catch (bakeErr) {
              logger.warn(
                "processPdfItems:bakeRotation",
                `failed for ${filename}: ${String(bakeErr)}`
              );
            }
          }

          logger.info(
            "processPdfItems:extractOwners",
            `done  ${done}/${targetItems.length} — ${filename} (${owners.length} owner${owners.length !== 1 ? "s" : ""})`
          );
          set((s) => ({
            items: s.items.map((i) => {
              if (i.id !== item.id) return i;
              const next: PdfItem = { ...(i as PdfItem), pdfPath: effectivePdfPath, autoRotated };
              if (options.detectOwners) {
                next.owners = owners;
                next.pageOwners = pageOwners;
              }
              if (options.detectRotation) {
                next.pageRotationCorrections = pageRotationCorrections;
              }
              return next;
            }),
            progress: done / targetItems.length,
            statusMessage: strings.status.extractingOwners(done, targetItems.length),
          }));
        } catch (e) {
          done++;
          failedCount++;
          logger.warn(
            "processPdfItems:extractOwners",
            `fail  ${done}/${targetItems.length} — ${filename} — ${String(e)}`
          );
          set((s) => ({
            items: s.items.map((i) => (i.id === item.id ? { ...i, ownersError: String(e) } : i)),
            progress: done / targetItems.length,
            statusMessage: strings.status.extractingOwners(done, targetItems.length),
          }));
        }
      }
    } finally {
      const ownerNames = Array.from(allFoundOwners.values())
        .map((o) => `${o.name} (${o.code})`)
        .join(", ");
      logger.info(
        "processPdfItems:extractOwners",
        `complete — ${targetItems.length} PDF${targetItems.length !== 1 ? "s" : ""}, ${allFoundOwners.size} propriétaire${allFoundOwners.size !== 1 ? "s" : ""} distinct${allFoundOwners.size !== 1 ? "s" : ""}${failedCount ? ` (${failedCount} en échec)` : ""}${ownerNames ? ` : ${ownerNames}` : ""}`
      );
      set({
        status: "idle",
        progress: null,
        statusMessage:
          allFoundOwners.size > 0
            ? strings.status.pdfsAddedWithOwners(targetItems.length, allFoundOwners.size)
            : strings.status.pdfsAdded(targetItems.length),
      });
    }
  }

  return {
    pptxSources: [],
    items: [],
    selectedIds: new Set(),
    status: "idle",
    statusMessage: strings.status.ready,
    progress: null,
    lastOutputPath: null,
    lastOutputDir: null,
    ownersDetectionEnabled: false,
    rotationDetectionEnabled: false,

    setSelectedIds: (ids) => set({ selectedIds: ids }),
    clearSelection: () => set({ selectedIds: new Set() }),

    // ── loadPptx ─────────────────────────────────────────────────────────────
    loadPptx: async (defaultPath?: string) => {
      const path = await Bridge.pickPptxFile(defaultPath);
      if (!path) {
        logger.action("loadPptx:cancelled");
        return;
      }

      logger.action("loadPptx", { path });

      const color = PPTX_COLORS[get().pptxSources.length % PPTX_COLORS.length];

      set({ status: "converting", statusMessage: strings.status.converting });

      try {
        const mergedPdf = await Bridge.convertPptx(path);
        set({ status: "extracting", statusMessage: strings.status.extracting });
        const count = await Bridge.getPdfPageCount(mergedPdf);

        const sourceId = uuid();
        const newSource: PptxSource = {
          id: sourceId,
          pptxPath: path,
          slidePdf: mergedPdf,
          slideCount: count,
          color,
        };

        const slideItems: SlideItem[] = Array.from({ length: count }, (_, i) => ({
          id: uuid(),
          type: "slide",
          slideIndex: i,
          rotation: 0,
          pptxSourceId: sourceId,
        }));

        set((s) => ({
          pptxSources: [...s.pptxSources, newSource],
          items: [...s.items, ...slideItems],
          status: "idle",
          statusMessage: strings.status.pptxLoaded(count),
        }));
        logger.info("loadPptx", `OK — ${count} slides from "${path}"`);
      } catch (e) {
        logger.error("loadPptx", e);
        set({ status: "error", statusMessage: String(e) });
      }
    },

    // ── addPdfs ──────────────────────────────────────────────────────────────
    addPdfs: async (defaultPath?: string) => {
      const paths = await Bridge.pickPdfFiles(defaultPath);
      if (!paths || paths.length === 0) {
        logger.action("addPdfs:cancelled");
        return;
      }

      logger.action("addPdfs", {
        count: paths.length,
        files: paths.map((p) => p.split(/[\\/]/).pop()),
      });

      const newItems: PdfItem[] = paths.map((p) => ({
        id: uuid(),
        type: "pdf",
        pdfPath: p,
        rotation: 0,
      }));

      set((s) => ({ items: [...s.items, ...newItems] }));

      const { ownersDetectionEnabled, rotationDetectionEnabled } = get();
      if (!ownersDetectionEnabled && !rotationDetectionEnabled) {
        set({ statusMessage: strings.status.pdfsAdded(newItems.length) });
        return;
      }

      await processPdfItems(newItems, {
        detectOwners: ownersDetectionEnabled,
        detectRotation: rotationDetectionEnabled,
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
    generate: async () => {
      const { items, pptxSources, lastOutputPath, lastOutputDir } = get();
      const hasPdf = items.some((i) => i.type === "pdf");
      if (!hasPdf) return;

      // Guard: if any PDF still has owners === undefined (and no error), extraction is in progress
      const hasPendingExtraction = items.some(
        (i) => i.type === "pdf" && i.owners === undefined && !i.ownersError
      );
      if (hasPendingExtraction) {
        set({ statusMessage: strings.status.ownersNotReady });
        return;
      }

      // Collect all distinct owners across all PdfItems
      const allOwners = new Map<string, OwnerInfo>();
      for (const item of items) {
        if (item.type === "pdf" && item.owners) {
          for (const owner of item.owners) {
            if (!allOwners.has(owner.name)) allOwners.set(owner.name, owner);
          }
        }
      }
      const isMultiOwner = allOwners.size > 1;

      if (isMultiOwner) {
        const ownerNames = Array.from(allOwners.values())
          .map((o) => o.name)
          .join(", ");
        const proceed = confirm(strings.confirm.multiOwnerSplit(allOwners.size, ownerNames));
        if (!proceed) return;
      }

      // Use separate last-path memory for file vs directory modes
      const previousPath = isMultiOwner ? lastOutputDir : lastOutputPath;

      let basePath = isMultiOwner
        ? await Bridge.pickSaveDirectory()
        : await Bridge.pickSaveLocation();
      if (!basePath) {
        if (previousPath) {
          const msg = isMultiOwner
            ? strings.confirm.reuseOutputSplit(previousPath)
            : strings.confirm.reuseOutput(previousPath);
          const reuse = confirm(msg);
          if (!reuse) return;
          basePath = previousPath;
        } else {
          return;
        }
      }

      logger.action("generate", {
        itemCount: items.length,
        isMultiOwner,
        ownerCount: allOwners.size,
      });
      set({ status: "merging", statusMessage: strings.status.preparingMerge, progress: 0 });

      try {
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

        // Preload all source documents
        for (const item of items) {
          if (item.type === "pdf") await loadOrCacheDoc(item.pdfPath);
        }
        const usedSourceIds = new Set(
          items.filter((i): i is SlideItem => i.type === "slide").map((i) => i.pptxSourceId)
        );
        for (const source of pptxSources) {
          if (usedSourceIds.has(source.id)) await loadOrCacheDoc(source.slidePdf);
        }

        // Normalize to forward slashes, then strip trailing slash except on filesystem roots (/ or C:/)
        const normalizedBase = basePath.replace(/\\/g, "/");
        const dir =
          normalizedBase === "/" || /^[A-Za-z]:\/$/.test(normalizedBase)
            ? normalizedBase
            : normalizedBase.replace(/\/$/, "");

        if (isMultiOwner) {
          const ownersList = Array.from(allOwners.values());

          for (let ownerIndex = 0; ownerIndex < ownersList.length; ownerIndex++) {
            const owner = ownersList[ownerIndex];
            set({
              progress: ownerIndex / ownersList.length,
              statusMessage: strings.status.mergingOwner(
                ownerIndex + 1,
                ownersList.length,
                owner.name
              ),
            });

            const merged = await PDFDocument.create();

            for (const item of items) {
              if (item.type === "slide") {
                const source = pptxSources.find((s) => s.id === item.pptxSourceId);
                if (!source) continue;
                const doc = await loadOrCacheDoc(source.slidePdf);
                const [page] = await merged.copyPages(doc, [item.slideIndex]);
                if (item.rotation !== 0) {
                  page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
                }
                merged.addPage(page);
              } else {
                const doc = await loadOrCacheDoc(item.pdfPath);
                const pageCount = doc.getPageCount();

                if (!item.owners || item.owners.length === 0) {
                  // No owner detected → include all pages in every output
                  const allIndices = doc.getPageIndices();
                  // Capture effective source rotations before copying (pdf-lib resolves
                  // inherited /Rotate; copyPages does not propagate it into the new doc).
                  const sourceRotations = allIndices.map(
                    (idx) => doc.getPage(idx).getRotation().angle
                  );
                  const pages = await merged.copyPages(doc, allIndices);
                  pages.forEach((p: PDFPage, i: number) => {
                    const pageNum = allIndices[i] + 1;
                    // When autoRotated, correction is already baked into pdfPath (temp file).
                    // Use sourceRotations[i] from the temp file which already holds the corrected /Rotate.
                    const correction = item.autoRotated
                      ? 0
                      : (item.pageRotationCorrections?.get(pageNum) ?? 0);
                    const totalRotation =
                      correction !== 0
                        ? (correction + item.rotation) % 360
                        : (sourceRotations[i] + item.rotation) % 360;
                    logger.info(
                      "generate:rotate",
                      `page ${pageNum}: src=${sourceRotations[i]}° auto=${correction}° user=${item.rotation}° → ${totalRotation}°`
                    );
                    if (totalRotation !== 0 || sourceRotations[i] !== 0) {
                      p.setRotation(degrees(totalRotation));
                    }
                    merged.addPage(p);
                  });
                } else if (item.owners.some((o) => o.name === owner.name)) {
                  // PDF contains this owner — batch-collect indices first, then copyPages once
                  const pageOwners = item.pageOwners ?? new Map();
                  const includedIndices: number[] = [];
                  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
                    const pageOwner = pageOwners.get(pageIdx + 1);
                    if (!pageOwner || pageOwner.name === owner.name) {
                      includedIndices.push(pageIdx);
                    }
                  }
                  if (includedIndices.length > 0) {
                    const sourceRotations = includedIndices.map(
                      (idx) => doc.getPage(idx).getRotation().angle
                    );
                    const pages = await merged.copyPages(doc, includedIndices);
                    pages.forEach((p: PDFPage, i: number) => {
                      const pageNum = includedIndices[i] + 1;
                      const correction = item.autoRotated
                        ? 0
                        : (item.pageRotationCorrections?.get(pageNum) ?? 0);
                      const totalRotation =
                        correction !== 0
                          ? (correction + item.rotation) % 360
                          : (sourceRotations[i] + item.rotation) % 360;
                      logger.info(
                        "generate:rotate",
                        `page ${pageNum}: src=${sourceRotations[i]}° auto=${correction}° user=${item.rotation}° → ${totalRotation}°`
                      );
                      if (totalRotation !== 0 || sourceRotations[i] !== 0) {
                        p.setRotation(degrees(totalRotation));
                      }
                      merged.addPage(p);
                    });
                  }
                }
                // else: PDF belongs exclusively to other owners → skip
              }
            }

            // Fallback to owner.code if snake_case produces an empty string
            const filename = ownerToSnakeCase(owner.name) || owner.code;
            const outputPath = `${dir}/${filename}.pdf`;
            const bytes = await merged.save();
            await writeFile(outputPath, bytes);
            logger.info("generate", `split PDF saved → ${outputPath}`);
          }

          logger.info("generate", `split complete — ${ownersList.length} PDFs`);
          set({
            status: "idle",
            statusMessage: strings.status.splitSaved(ownersList.length, dir),
            progress: null,
            lastOutputDir: dir,
          });
        } else {
          // Single-owner or no owner: produce one merged PDF (original behavior)
          const merged = await PDFDocument.create();
          let totalPages = 0;
          for (const item of items) {
            if (item.type === "pdf") {
              totalPages += (await loadOrCacheDoc(item.pdfPath)).getPageCount();
            } else {
              totalPages += 1;
            }
          }

          let mergedPageCount = 0;
          for (const item of items) {
            if (item.type === "pdf") {
              const doc = await loadOrCacheDoc(item.pdfPath);
              const indices = doc.getPageIndices();
              const sourceRotations = indices.map((idx) => doc.getPage(idx).getRotation().angle);
              const pages = await merged.copyPages(doc, indices);
              pages.forEach((p: PDFPage, i: number) => {
                const pageNum = indices[i] + 1;
                const correction = item.autoRotated
                  ? 0
                  : (item.pageRotationCorrections?.get(pageNum) ?? 0);
                const totalRotation =
                  correction !== 0
                    ? (correction + item.rotation) % 360
                    : (sourceRotations[i] + item.rotation) % 360;
                logger.info(
                  "generate:rotate",
                  `page ${pageNum}: src=${sourceRotations[i]}° auto=${correction}° user=${item.rotation}° → ${totalRotation}°`
                );
                if (totalRotation !== 0 || sourceRotations[i] !== 0) {
                  p.setRotation(degrees(totalRotation));
                }
                merged.addPage(p);
              });
              mergedPageCount += doc.getPageCount();
            } else {
              const source = pptxSources.find((s) => s.id === item.pptxSourceId);
              if (!source) continue;
              const doc = await loadOrCacheDoc(source.slidePdf);
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
          await writeFile(basePath, bytes);

          logger.info("generate", `PDF saved → ${basePath}`);
          set({
            status: "idle",
            statusMessage: strings.status.pdfSaved(basePath),
            progress: null,
            lastOutputPath: basePath,
          });
        }
      } catch (e) {
        logger.error("generate", e);
        set({ status: "error", statusMessage: String(e), progress: null });
      }
    },

    // ── clearError ────────────────────────────────────────────────────────────
    clearError: () => set({ status: "idle", statusMessage: strings.status.ready }),

    // ── Detection toggles ─────────────────────────────────────────────────────
    setOwnersDetectionEnabled: (enabled) => {
      logger.action("setOwnersDetectionEnabled", { enabled });
      set({ ownersDetectionEnabled: enabled });
    },
    setRotationDetectionEnabled: (enabled) => {
      logger.action("setRotationDetectionEnabled", { enabled });
      set({ rotationDetectionEnabled: enabled });
    },
  };
});
