import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PdfItem } from "../../types";
import { useMergeStore } from "../../store/useMergeStore";
import { basename } from "../../utils/path";
import { ZoomThumb } from "./ZoomThumb";
import { Bridge } from "../../services/bridge";
import { strings } from "../../strings";

interface Props {
  item: PdfItem;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  isGroupFollower: boolean;
}

export function PdfItemRow({ item, selected, onSelect, isGroupFollower }: Props) {
  const removeItem = useMergeStore((s) => s.removeItem);
  const rotateItems = useMergeStore((s) => s.rotateItems);
  const selectedIds = useMergeStore((s) => s.selectedIds);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

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
      {...listeners}
      {...attributes}
      onClick={onSelect}
      onDoubleClick={() => Bridge.openFile(item.pdfPath).catch((e) => alert(String(e)))}
      title={strings.pdfItem.openTooltip}
    >
      {isGroupFollower && <div style={styles.followerBar} />}
      <span style={styles.handle}>⠿</span>
      <div style={{ position: "relative", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ transform: `rotate(${item.rotation}deg)`, transition: "transform 0.2s" }}>
          <ZoomThumb
            pdfPath={item.pdfPath}
            pageIndex={0}
            alt={basename(item.pdfPath)}
            rotation={item.rotation}
          />
        </div>
        {item.rotation !== 0 && <span style={styles.rotationBadge}>{item.rotation}°</span>}
      </div>
      <span style={styles.nameBlock}>
        <span style={styles.name}>{basename(item.pdfPath)}</span>
        {item.owners && item.owners.length > 0 && (
          <span style={styles.ownerChip}>{item.owners.map((o) => o.name).join(" · ")}</span>
        )}
      </span>
      <button
        style={styles.rotate}
        onClick={(e) => {
          e.stopPropagation();
          const ids = selected && selectedIds.size > 1 ? [...selectedIds] : [item.id];
          rotateItems(ids);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        title={
          selected && selectedIds.size > 1
            ? strings.pdfItem.rotateTooltipMulti(selectedIds.size)
            : strings.pdfItem.rotateTooltip
        }
      >
        ↻
      </button>
      <button
        style={styles.remove}
        onClick={(e) => {
          e.stopPropagation();
          removeItem(item.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
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
    padding: "8px 12px",
    background: "var(--bg-item-pdf)",
    borderRadius: 6,
    border: "1px solid var(--border-item-pdf)",
    userSelect: "none",
    cursor: "pointer",
    transition: "border-color 0.1s, background 0.1s, opacity 0.15s",
  },
  rowSelected: {
    background: "var(--bg-item-pdf-selected)",
    borderColor: "var(--accent)",
  },
  rowFollower: {
    borderColor: "var(--accent)",
    borderStyle: "dashed",
  },
  followerBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    background: "var(--accent)",
    borderRadius: "6px 0 0 6px",
  },
  handle: {
    cursor: "grab",
    color: "var(--text-handle-pdf)",
    fontSize: 16,
    padding: "0 4px",
    flexShrink: 0,
  },
  rotate: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 6px",
    borderRadius: 4,
    flexShrink: 0,
  },
  rotationBadge: {
    position: "absolute" as const,
    bottom: 2,
    right: 2,
    background: "var(--rotation-badge-bg)",
    color: "var(--rotation-badge-text)",
    fontSize: 9,
    padding: "1px 3px",
    borderRadius: 3,
    pointerEvents: "none" as const,
  },
  nameBlock: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    gap: 2,
  },
  name: {
    color: "var(--text-primary)",
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ownerChip: {
    color: "var(--text-muted)",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  remove: {
    background: "none",
    border: "none",
    color: "var(--error)",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: 4,
  },
};
