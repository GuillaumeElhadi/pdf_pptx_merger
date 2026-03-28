import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PdfItem } from "../../types";
import { useMergeStore } from "../../store/useMergeStore";
import { basename } from "../../utils/path";

interface Props {
  item: PdfItem;
}

export function PdfItemRow({ item }: Props) {
  const removeItem = useMergeStore((s) => s.removeItem);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...styles.row,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <span style={styles.handle} {...listeners} {...attributes}>
        ⠿
      </span>
      <span style={styles.icon}>📄</span>
      <span style={styles.name}>{basename(item.pdfPath)}</span>
      <button style={styles.remove} onClick={() => removeItem(item.id)}>
        ✕
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    background: "#2a2a2a",
    borderRadius: 6,
    border: "1px solid #383838",
    userSelect: "none",
  },
  handle: {
    cursor: "grab",
    color: "#555",
    fontSize: 16,
    padding: "0 4px",
  },
  icon: { fontSize: 16 },
  name: {
    flex: 1,
    color: "#ddd",
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
  },
};
