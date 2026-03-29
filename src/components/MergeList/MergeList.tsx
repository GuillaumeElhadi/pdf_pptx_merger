import { useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
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
import { PdfItemRow } from "./PdfItemRow";
import { SlideItemRow } from "./SlideItemRow";

export function MergeList() {
  const { items, selectedSlideIds, setSelectedSlideIds, clearSelection, reorderItems } =
    useMergeStore();
  const lastClickedIdRef = useRef<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const currentSelection = useMergeStore.getState().selectedSlideIds;
    setActiveDragId(null);
    clearSelection();
    lastClickedIdRef.current = null;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderItems(String(active.id), String(over.id), currentSelection);
  };

  const handleDragCancel = () => setActiveDragId(null);

  const handleSlideSelect = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (e.shiftKey && lastClickedIdRef.current) {
      const slideItems = items.filter((i) => i.type === "slide");
      const idxA = slideItems.findIndex((i) => i.id === lastClickedIdRef.current);
      const idxB = slideItems.findIndex((i) => i.id === itemId);
      if (idxA !== -1 && idxB !== -1) {
        const lo = Math.min(idxA, idxB);
        const hi = Math.max(idxA, idxB);
        const rangeIds = slideItems.slice(lo, hi + 1).map((i) => i.id);
        setSelectedSlideIds(new Set([...selectedSlideIds, ...rangeIds]));
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedSlideIds);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      setSelectedSlideIds(next);
    } else {
      setSelectedSlideIds(new Set([itemId]));
    }

    lastClickedIdRef.current = itemId;
  };

  if (items.length === 0) {
    return (
      <div style={styles.empty}>
        Add PDFs and load a PPTX, then drag to arrange them.
      </div>
    );
  }

  const groupDragActive =
    activeDragId !== null &&
    selectedSlideIds.has(activeDragId) &&
    selectedSlideIds.size > 1;

  return (
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
              <PdfItemRow key={item.id} item={item} />
            ) : (
              <SlideItemRow
                key={item.id}
                item={item}
                selected={selectedSlideIds.has(item.id)}
                onSelect={(e) => handleSlideSelect(item.id, e)}
                isGroupFollower={
                  groupDragActive &&
                  item.id !== activeDragId &&
                  selectedSlideIds.has(item.id)
                }
              />
            )
          )}
        </div>
      </SortableContext>
    </DndContext>
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
    color: "#555",
    fontStyle: "italic",
    textAlign: "center",
    paddingTop: 60,
    fontSize: 14,
    userSelect: "none",
  },
};
