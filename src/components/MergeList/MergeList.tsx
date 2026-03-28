import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMergeStore } from "../../store/useMergeStore";
import { PdfItemRow } from "./PdfItemRow";
import { SlideGroupItemRow } from "./SlideGroupItemRow";

export function MergeList() {
  const { items, reorderItems } = useMergeStore();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderItems(String(active.id), String(over.id));
    }
  };

  if (items.length === 0) {
    return (
      <div style={styles.empty}>
        Add PDFs and slide groups, then drag to arrange them.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
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
              <SlideGroupItemRow key={item.id} item={item} />
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
  },
  empty: {
    color: "#555",
    fontStyle: "italic",
    textAlign: "center",
    paddingTop: 60,
    fontSize: 14,
  },
};
