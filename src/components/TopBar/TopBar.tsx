import { useMergeStore } from "../../store/useMergeStore";

export function TopBar() {
  const { pptxPath, slidePdfs, items, status, loadPptx, addPdfs } =
    useMergeStore();

  const isConverting = status === "converting";
  const isMerging = status === "merging";
  const busy = isConverting || isMerging;
  const hasPptx = slidePdfs.length > 0;
  const hasPdf = items.some((i) => i.type === "pdf");

  const handleAddSlideGroup = () => {
    // Open the slide picker — we signal via a custom event so the
    // picker (rendered in App) can open without prop drilling.
    window.dispatchEvent(new CustomEvent("open-slide-picker", { detail: { mode: "create" } }));
  };

  return (
    <header style={styles.bar}>
      <span style={styles.title}>PDF Merger</span>

      <div style={styles.actions}>
        <button
          style={styles.btn}
          onClick={loadPptx}
          disabled={busy}
          title={pptxPath ?? "No PPTX loaded"}
        >
          {isConverting ? "Converting…" : "📄 Load PPTX"}
        </button>

        <button style={styles.btn} onClick={addPdfs} disabled={busy}>
          ＋ Add PDFs
        </button>

        <button
          style={{ ...styles.btn, opacity: hasPptx ? 1 : 0.4 }}
          onClick={handleAddSlideGroup}
          disabled={!hasPptx || busy}
          title={hasPptx ? "Add a slide group" : "Load a PPTX first"}
        >
          ▦ Add slide group
        </button>
      </div>

      <button
        style={{
          ...styles.btn,
          ...styles.generateBtn,
          opacity: hasPdf && !busy ? 1 : 0.4,
        }}
        disabled={!hasPdf || busy}
        onClick={() => useMergeStore.getState().generate()}
      >
        {isMerging ? "Generating…" : "⚙ Generate PDF"}
      </button>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    background: "#252525",
    borderBottom: "1px solid #333",
  },
  title: {
    fontWeight: 700,
    fontSize: 15,
    color: "#fff",
    marginRight: 12,
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    gap: 6,
    flex: 1,
  },
  btn: {
    padding: "6px 14px",
    border: "none",
    borderRadius: 4,
    background: "#3a3a3a",
    color: "#ddd",
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  generateBtn: {
    background: "#c05000",
    color: "#fff",
    fontWeight: 600,
  },
};
