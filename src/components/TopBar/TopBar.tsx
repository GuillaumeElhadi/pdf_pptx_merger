import { useEffect, useState } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";
import { strings } from "../../strings";
import { useTheme } from "../../hooks/useTheme";

export function TopBar() {
  const { pptxPath, items, status, loadPptx, addPdfs } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    Bridge.getGoogleDrivePath().then(setGoogleDrivePath);
  }, []);

  const isConverting = status === "converting";
  const isMerging = status === "merging";
  const busy = isConverting || isMerging;
  const hasPdf = items.some((i) => i.type === "pdf");

  return (
    <header style={styles.bar}>
      <span style={styles.title}>PDF Merger</span>

      <div style={styles.actions}>
        <div style={styles.btnGroup}>
          <button
            style={styles.btn}
            onClick={() => loadPptx()}
            disabled={busy}
            title={pptxPath ?? strings.topBar.loadPptxNoFile}
          >
            {isConverting ? strings.topBar.loadPptxConverting : strings.topBar.loadPptx}
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => loadPptx(googleDrivePath)}
              disabled={busy}
              title={strings.topBar.googleDriveTooltip(googleDrivePath)}
            >
              ☁
            </button>
          )}
        </div>

        <div style={styles.btnGroup}>
          <button
            style={styles.btn}
            onClick={() => addPdfs()}
            disabled={busy}
          >
            {strings.topBar.addPdfs}
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => addPdfs(googleDrivePath)}
              disabled={busy}
              title={strings.topBar.googleDriveTooltip(googleDrivePath)}
            >
              ☁
            </button>
          )}
        </div>
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
        {isMerging ? strings.topBar.generatePdfMerging : strings.topBar.generatePdf}
      </button>

      <button
        style={styles.themeBtn}
        onClick={toggleTheme}
        title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      >
        {theme === "dark" ? "☀" : "🌙"}
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
    background: "var(--bg-bar)",
    borderBottom: "1px solid var(--border-bar)",
  },
  title: {
    fontWeight: 700,
    fontSize: 15,
    color: "var(--text-title)",
    marginRight: 12,
    whiteSpace: "nowrap",
  },
  actions: {
    display: "flex",
    gap: 6,
    flex: 1,
  },
  btnGroup: {
    display: "flex",
    gap: 1,
  },
  btn: {
    padding: "6px 14px",
    border: "none",
    borderRadius: 4,
    background: "var(--btn-bg)",
    color: "var(--btn-text)",
    cursor: "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  },
  driveBtn: {
    padding: "6px 10px",
    borderRadius: "0 4px 4px 0",
    background: "var(--btn-drive-bg)",
    color: "#fff",
    fontSize: 12,
  },
  generateBtn: {
    background: "var(--btn-generate-bg)",
    color: "#fff",
    fontWeight: 600,
  },
  themeBtn: {
    padding: "6px 10px",
    border: "none",
    borderRadius: 4,
    background: "var(--btn-bg)",
    color: "var(--btn-text)",
    cursor: "pointer",
    fontSize: 14,
    flexShrink: 0,
  },
};
