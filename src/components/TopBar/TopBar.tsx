import { useEffect, useState } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";
import { strings } from "../../strings";
import { useTheme } from "../../hooks/useTheme";

export function TopBar() {
  const {
    pptxSources,
    items,
    status,
    loadPptx,
    addPdfs,
    ownersDetectionEnabled,
    rotationDetectionEnabled,
    setOwnersDetectionEnabled,
    setRotationDetectionEnabled,
  } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    Bridge.getGoogleDrivePath().then(setGoogleDrivePath);
  }, []);

  const isConverting = status === "converting";
  const isMerging = status === "merging";
  const busy = isConverting || isMerging || status === "extracting";
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
              disabled={busy}
              title={strings.topBar.googleDriveTooltip(googleDrivePath)}
            >
              ☁
            </button>
          )}
        </div>

        <div style={styles.btnGroup}>
          <button style={styles.btn} onClick={() => addPdfs()} disabled={busy}>
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

      <div style={styles.toggleGroup}>
        <label style={styles.toggleLabel}>
          <span style={switchTrackStyle(ownersDetectionEnabled, busy)}>
            <input
              type="checkbox"
              checked={ownersDetectionEnabled}
              onChange={(e) => setOwnersDetectionEnabled(e.target.checked)}
              disabled={busy}
              style={styles.switchInput}
            />
            <span style={switchThumbStyle(ownersDetectionEnabled)} />
          </span>
          {strings.topBar.ownersToggle}
        </label>
        <label style={styles.toggleLabel}>
          <span style={switchTrackStyle(rotationDetectionEnabled, busy)}>
            <input
              type="checkbox"
              checked={rotationDetectionEnabled}
              onChange={(e) => setRotationDetectionEnabled(e.target.checked)}
              disabled={busy}
              style={styles.switchInput}
            />
            <span style={switchThumbStyle(rotationDetectionEnabled)} />
          </span>
          {strings.topBar.rotationToggle}
        </label>
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
  toggleGroup: {
    display: "flex",
    gap: 12,
    flexShrink: 0,
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-title)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  switchInput: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    margin: 0,
    opacity: 0,
    cursor: "pointer",
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

const SWITCH_WIDTH = 32;
const SWITCH_HEIGHT = 18;
const THUMB_SIZE = 14;
const THUMB_INSET = 2;

function switchTrackStyle(checked: boolean, disabled: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-block",
    flexShrink: 0,
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
    background: checked ? "var(--btn-generate-bg)" : "var(--btn-bg)",
    opacity: disabled ? 0.5 : 1,
    transition: "background-color 0.15s ease",
  };
}

function switchThumbStyle(checked: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: THUMB_INSET,
    left: checked ? SWITCH_WIDTH - THUMB_SIZE - THUMB_INSET : THUMB_INSET,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
    transition: "left 0.15s ease",
    pointerEvents: "none",
  };
}
