import { useState, useEffect } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { SlideThumb } from "./SlideThumb";

interface Props {
  mode: "create" | "edit";
  editId?: string;
  onClose: () => void;
}

export function SlidePicker({ mode, editId, onClose }: Props) {
  const { slidePdfs, usedSlideIndices, items, addSlideGroup, updateSlideGroup } =
    useMergeStore();

  // Pre-fill selection when editing
  const existingGroup =
    mode === "edit" ? items.find((i) => i.id === editId) : undefined;
  const existingIndices =
    existingGroup?.type === "slide-group" ? existingGroup.slideIndices : [];

  const [selected, setSelected] = useState<Set<number>>(new Set(existingIndices));

  useEffect(() => {
    // Reset selection if picker is reopened for a different group
    setSelected(new Set(existingIndices));
  }, [editId]);

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const confirm = () => {
    if (selected.size === 0) return;
    const sorted = [...selected].sort((a, b) => a - b);
    if (mode === "create") {
      addSlideGroup(sorted);
    } else if (editId) {
      updateSlideGroup(editId, sorted);
    }
    onClose();
  };

  const getState = (idx: number): "available" | "selected" | "used" => {
    if (selected.has(idx)) return "selected";
    // In edit mode, the current group's slides are "available" to toggle
    const belongsToCurrentGroup = existingIndices.includes(idx);
    if (usedSlideIndices.has(idx) && !belongsToCurrentGroup) return "used";
    return "available";
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.title}>
          {mode === "create" ? "Add slide group" : "Edit slide group"}
        </h2>

        <div style={styles.grid}>
          {slidePdfs.map((pdf, idx) => (
            <SlideThumb
              key={idx}
              pdfPath={pdf}
              slideNumber={idx + 1}
              state={getState(idx)}
              onToggle={() => toggle(idx)}
            />
          ))}
        </div>

        <footer style={styles.footer}>
          <span style={styles.count}>
            {selected.size} slide{selected.size !== 1 ? "s" : ""} selected
          </span>
          <button style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{
              ...styles.confirmBtn,
              opacity: selected.size > 0 ? 1 : 0.4,
            }}
            disabled={selected.size === 0}
            onClick={confirm}
          >
            ✓ Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#1e1e1e",
    borderRadius: 10,
    padding: 24,
    width: "min(880px, 92vw)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    border: "1px solid #333",
  },
  title: {
    margin: 0,
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
  },
  grid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    overflowY: "auto",
    flex: 1,
    padding: 4,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    borderTop: "1px solid #333",
    paddingTop: 12,
  },
  count: {
    flex: 1,
    color: "#888",
    fontSize: 13,
  },
  cancelBtn: {
    padding: "6px 16px",
    background: "#333",
    border: "none",
    borderRadius: 4,
    color: "#aaa",
    cursor: "pointer",
    fontSize: 13,
  },
  confirmBtn: {
    padding: "6px 20px",
    background: "#2d6a2d",
    border: "none",
    borderRadius: 4,
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
};
