import { useState, useRef, createContext, useContext } from "react";

export const DragActiveContext = createContext(false);
export const useDragActive = () => useContext(DragActiveContext);
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMergeStore } from "../../store/useMergeStore";
import { strings } from "../../strings";
import { PdfItemRow } from "./PdfItemRow";
import { SlideItemRow } from "./SlideItemRow";

export function MergeList() {
  const { items, selectedIds, setSelectedIds, clearSelection, reorderItems } =
    useMergeStore();
  const lastClickedIdRef = useRef<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const currentSelection = useMergeStore.getState().selectedIds;
    setActiveDragId(null);
    clearSelection();
    lastClickedIdRef.current = null;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderItems(String(active.id), String(over.id), currentSelection);
  };

  const handleDragCancel = () => setActiveDragId(null);

  const handleItemSelect = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (e.shiftKey && lastClickedIdRef.current) {
      const idxA = items.findIndex((i) => i.id === lastClickedIdRef.current);
      const idxB = items.findIndex((i) => i.id === itemId);
      if (idxA !== -1 && idxB !== -1) {
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        const rangeIds = items.slice(lo, hi + 1).map((i) => i.id);
        setSelectedIds(new Set([...selectedIds, ...rangeIds]));
        return;
      }
    }

    // Toggle: click adds to selection, click again removes — no Ctrl required
    const next = new Set(selectedIds);
    next.has(itemId) ? next.delete(itemId) : next.add(itemId);
    setSelectedIds(next);
    lastClickedIdRef.current = itemId;
  };

  if (items.length === 0) {
    return (
      <div style={styles.empty}>
        {strings.mergeList.empty}
      </div>
    );
  }

  const groupDragActive =
    activeDragId !== null &&
    selectedIds.has(activeDragId) &&
    selectedIds.size > 1;

  return (
    <DragActiveContext.Provider value={activeDragId !== null}>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <div style={styles.list}>
          {items.map((item) =>
            item.type === "pdf" ? (
              <PdfItemRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onSelect={(e) => handleItemSelect(item.id, e)}
                isGroupFollower={
                  groupDragActive &&
                  item.id !== activeDragId &&
                  selectedIds.has(item.id)
                }
              />
            ) : (
              <SlideItemRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onSelect={(e) => handleItemSelect(item.id, e)}
                isGroupFollower={
                  groupDragActive &&
                  item.id !== activeDragId &&
                  selectedIds.has(item.id)
                }
              />
            )
          )}
        </div>
      </SortableContext>
    </DndContext>
    </DragActiveContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 16px",
    userSelect: "none",
  },
  empty: {
    color: "var(--text-empty)",
    fontStyle: "italic",
    textAlign: "center",
    paddingTop: 60,
    fontSize: 14,
    userSelect: "none",
  },
};
