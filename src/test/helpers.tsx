import React from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ThemeContext } from "../hooks/useTheme";
import { useMergeStore } from "../store/useMergeStore";
import { strings } from "../strings";
import type { PdfItem, SlideItem } from "../types";

// ── Store reset ───────────────────────────────────────────────────────────────

export function resetStore() {
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
  });
}

// ── Item factories ────────────────────────────────────────────────────────────

export function makePdf(id: string, path = `/files/${id}.pdf`): PdfItem {
  return { id, type: "pdf", pdfPath: path, rotation: 0 };
}

export function makeSlide(id: string, slideIndex = 0): SlideItem {
  return { id, type: "slide", slideIndex, rotation: 0 };
}

// ── Wrappers ──────────────────────────────────────────────────────────────────

/**
 * Fournit le ThemeContext minimal requis par TopBar et ses enfants.
 */
export function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={{ theme: "dark", toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Fournit le contexte DnD requis par PdfItemRow, SlideItemRow et MergeList.
 * ids: liste des ids des items rendus (requis par SortableContext).
 */
export function DndWrapper({ children, ids }: { children: React.ReactNode; ids: string[] }) {
  // Distance très haute : le drag ne s'active jamais pendant les tests,
  // ce qui évite que dnd-kit intercepte les pointer events des boutons.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 999 } })
  );
  return (
    <DndContext sensors={sensors}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/**
 * Mock minimal d'un objet Update de @tauri-apps/plugin-updater.
 */
export function makeUpdate(version = "9.9.9") {
  return {
    version,
    date: "2026-01-01T00:00:00Z",
    body: "",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}
