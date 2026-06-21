import { useEffect, useState } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";
import { strings } from "../../strings";
import { useTheme } from "../../hooks/useTheme";
import { SettingsDialog } from "../SettingsDialog";

export function TopBar() {
  const {
    pptxSources,
    items,
    status,
    pdfPendingCount,
    pptxPendingCount,
    pptxTask,
    loadPptx,
    addPdfs,
  } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    Bridge.getGoogleDrivePath().then(setGoogleDrivePath);
  }, []);

  const isConverting = pptxTask !== null;
  const isMerging = status === "merging";
  const hasPdf = items.some((i) => i.type === "pdf");
  // Adding files only needs to wait out the final merge — conversion/detection
  // jobs run on their own background queues, so new files can keep being queued.
  const addDisabled = isMerging;
  const generateDisabled = !hasPdf || isMerging || pdfPendingCount > 0 || pptxPendingCount > 0;

  return (
    <header style={styles.bar}>
      <span style={styles.title}>PDF Merger</span>

      <div style={styles.actions}>
        <div style={styles.btnGroup}>
          <button
            style={styles.btn}
            onClick={() => loadPptx()}
            disabled={addDisabled}
            title={
              pptxSources.length === 0
                ? strings.topBar.loadPptxNoFile
                : pptxSources.map((s) => s.pptxPath.replace(/\\/g, "/").split("/").pop()).join("\n")
            }
          >
            {isConverting ? strings.topBar.loadPptxConverting : strings.topBar.loadPptx}
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => loadPptx(googleDrivePath)}
              disabled={addDisabled}
              title={strings.topBar.googleDriveTooltip(googleDrivePath)}
            >
              ☁
            </button>
          )}
        </div>

        <div style={styles.btnGroup}>
          <button style={styles.btn} onClick={() => addPdfs()} disabled={addDisabled}>
            {strings.topBar.addPdfs}
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => addPdfs(googleDrivePath)}
              disabled={addDisabled}
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
          opacity: !generateDisabled ? 1 : 0.4,
        }}
        disabled={generateDisabled}
        onClick={() => useMergeStore.getState().generate()}
      >
        {isMerging ? strings.topBar.generatePdfMerging : strings.topBar.generatePdf}
      </button>

      <button
        style={styles.themeBtn}
        onClick={() => setIsSettingsOpen(true)}
        title={strings.topBar.settingsTooltip}
      >
        🛠
      </button>

      <button
        style={styles.themeBtn}
        onClick={toggleTheme}
        title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      >
        {theme === "dark" ? "☀" : "🌙"}
      </button>

      {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}
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
