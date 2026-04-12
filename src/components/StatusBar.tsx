import { useMergeStore } from "../store/useMergeStore";
import { strings } from "../strings";
import { Update } from "@tauri-apps/plugin-updater";

interface Props {
  update: Update | null;
  currentVersion: string;
  onUpdateClick: () => void;
}

export function StatusBar({ update, currentVersion, onUpdateClick }: Props) {
  const { status, statusMessage, progress, clearError } = useMergeStore();

  const msgColor =
    status === "error"
      ? "var(--error)"
      : status === "converting" || status === "merging"
      ? "#f0a020"
      : "var(--text-muted)";

  const isUpToDate = update === null;
  const dotColor = isUpToDate ? "#4caf50" : "#f0a020";
  const versionLabel = currentVersion ? `v${currentVersion}` : "";
  const versionTitle = isUpToDate
    ? "Vous utilisez la dernière version"
    : `Mise à jour disponible : v${update?.version}`;

  return (
    <div style={styles.wrapper}>
      {progress !== null && (
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    <div style={styles.bar}>
      {(status === "converting" || status === "merging") && (
        <span style={styles.spinner}>⏳</span>
      )}
      <span style={{ ...styles.msg, color: msgColor }}>{statusMessage}</span>
      {status === "error" && (
        <button style={styles.dismiss} onClick={clearError}>
          {strings.statusBar.dismiss}
        </button>
      )}
      {versionLabel && (
        <button
          style={styles.versionBadge}
          onClick={!isUpToDate ? onUpdateClick : undefined}
          title={versionTitle}
          disabled={isUpToDate}
        >
          <span style={{ ...styles.dot, background: dotColor }} />
          {versionLabel}
        </button>
      )}
    </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: "var(--bg-statusbar)",
    borderTop: "1px solid var(--border-statusbar)",
  },
  progressTrack: {
    height: 2,
    background: "var(--border-statusbar)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "#f0a020",
    transition: "width 0.15s ease",
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 16px",
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
    border: "1px solid var(--error)",
    color: "var(--error)",
    borderRadius: 3,
    padding: "1px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
  versionBadge: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 10,
    cursor: "default",
    flexShrink: 0,
    userSelect: "none",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-block",
  },
};
