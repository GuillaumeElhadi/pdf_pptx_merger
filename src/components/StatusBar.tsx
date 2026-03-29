import { useMergeStore } from "../store/useMergeStore";
import { strings } from "../strings";

export function StatusBar() {
  const { status, statusMessage, clearError } = useMergeStore();

  const color =
    status === "error"
      ? "#ff6b6b"
      : status === "converting" || status === "merging"
      ? "#f0a020"
      : "#888";

  return (
    <div style={styles.bar}>
      {(status === "converting" || status === "merging") && (
        <span style={styles.spinner}>⏳</span>
      )}
      <span style={{ ...styles.msg, color }}>{statusMessage}</span>
      {status === "error" && (
        <button style={styles.dismiss} onClick={clearError}>
          {strings.statusBar.dismiss}
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 16px",
    background: "#141414",
    borderTop: "1px solid #222",
    minHeight: 28,
  },
  spinner: { fontSize: 12 },
  msg: {
    fontSize: 12,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dismiss: {
    background: "none",
    border: "1px solid #ff6b6b",
    color: "#ff6b6b",
    borderRadius: 3,
    padding: "1px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
};
