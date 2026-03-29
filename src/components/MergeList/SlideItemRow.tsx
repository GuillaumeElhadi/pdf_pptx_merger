import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlideItem } from "../../types";
import { useMergeStore } from "../../store/useMergeStore";
import { ZoomThumb } from "./ZoomThumb";

interface Props {
  item: SlideItem;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  /** True when another selected item is being dragged — this item will follow. */
  isGroupFollower: boolean;
}

export function SlideItemRow({ item, selected, onSelect, isGroupFollower }: Props) {
  const { slidePdf, removeItem } = useMergeStore();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const rowStyle: React.CSSProperties = {
    ...styles.row,
    ...(selected ? styles.rowSelected : {}),
    ...(isGroupFollower ? styles.rowFollower : {}),
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : isGroupFollower ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      onClick={onSelect}
      title={selected ? "Clic pour désélectionner" : "Clic pour sélectionner · Shift+clic pour une plage"}
    >
      {isGroupFollower && <div style={styles.followerBar} />}

      <span
        style={styles.handle}
        {...listeners}
        {...attributes}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </span>

      <div onClick={(e) => e.stopPropagation()}>
        <ZoomThumb
          pdfPath={slidePdf}
          pageIndex={item.slideIndex}
          alt={`Slide ${item.slideIndex + 1}`}
        />
      </div>

      <span style={styles.label}>Slide {item.slideIndex + 1}</span>

      {isGroupFollower && (
        <span style={styles.followerTag}>suit le déplacement</span>
      )}

      <button
        style={styles.remove}
        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
        title="Supprimer"
      >
        ✕
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 12px",
    background: "#1e3048",
    borderRadius: 6,
    border: "1px solid #2a4a6a",
    cursor: "pointer",
    userSelect: "none",
    transition: "border-color 0.1s, background 0.1s, opacity 0.15s",
  },
  rowSelected: {
    background: "#1a3a5c",
  },
  rowFollower: {
    borderColor: "#4a9eff",
    borderStyle: "dashed",
  },
  followerBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: "#4a9eff",
    borderRadius: "6px 0 0 6px",
  },
  followerTag: {
    fontSize: 11,
    color: "#4a9eff",
    opacity: 0.8,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  handle: {
    cursor: "grab",
    color: "#4a7aaa",
    fontSize: 16,
    padding: "0 4px",
    flexShrink: 0,
  },
  label: {
    flex: 1,
    color: "#88ccff",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  remove: {
    background: "none",
    border: "none",
    color: "#ff6b6b",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: 4,
    flexShrink: 0,
  },
};
