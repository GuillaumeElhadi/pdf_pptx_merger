import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlideGroupItem } from "../../types";
import { useMergeStore } from "../../store/useMergeStore";
import { useThumbnail } from "../../hooks/useThumbnail";

interface Props {
  item: SlideGroupItem;
}

export function SlideGroupItemRow({ item }: Props) {
  const { slidePdf, removeItem } = useMergeStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const handleEdit = () => {
    window.dispatchEvent(
      new CustomEvent("open-slide-picker", { detail: { mode: "edit", id: item.id } })
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...styles.row,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={handleEdit}
      title="Click to edit slide selection"
    >
      <span
        style={styles.handle}
        {...listeners}
        {...attributes}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </span>

      <span style={styles.icon}>🖼</span>

      <div style={styles.thumbStrip}>
        {item.slideIndices.slice(0, 4).map((idx) => (
          <MiniThumb key={idx} pdfPath={slidePdf} pageIndex={idx} />
        ))}
        {item.slideIndices.length > 4 && (
          <span style={styles.more}>+{item.slideIndices.length - 4}</span>
        )}
      </div>

      <span style={styles.label}>
        {item.slideIndices.length === 1
          ? `Slide ${item.slideIndices[0] + 1}`
          : `Slides ${item.slideIndices.map((i) => i + 1).join(", ")}`}
      </span>

      <button
        style={styles.remove}
        onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
      >
        ✕
      </button>
    </div>
  );
}

function MiniThumb({ pdfPath, pageIndex }: { pdfPath: string | null; pageIndex: number }) {
  const { url, loading } = useThumbnail(pdfPath, pageIndex, 48);
  return (
    <div style={styles.thumb}>
      {loading && <div style={styles.thumbPlaceholder} />}
      {url && <img src={url} style={styles.thumbImg} alt="" />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    background: "#1e3048",
    borderRadius: 6,
    border: "1px solid #2a4a6a",
    cursor: "pointer",
    userSelect: "none",
  },
  handle: {
    cursor: "grab",
    color: "#4a7aaa",
    fontSize: 16,
    padding: "0 4px",
  },
  icon: { fontSize: 16 },
  thumbStrip: {
    display: "flex",
    gap: 4,
    alignItems: "center",
  },
  thumb: {
    width: 40,
    height: 30,
    borderRadius: 3,
    overflow: "hidden",
    background: "#2a3a4a",
    flexShrink: 0,
  },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    background: "#2a3a4a",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  more: {
    color: "#88aacc",
    fontSize: 12,
    whiteSpace: "nowrap",
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
  },
};
