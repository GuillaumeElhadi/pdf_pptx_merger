import { useEffect, useState } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";

export function TopBar() {
  const { pptxPath, items, status, loadPptx, addPdfs } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);

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
            title={pptxPath ?? "Aucun PPTX chargé"}
          >
            {isConverting ? "Conversion…" : "📄 Ajout PowerPoint"}
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => loadPptx(googleDrivePath)}
              disabled={busy}
              title={`Ouvrir depuis Google Drive (${googleDrivePath})`}
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
            ＋ Ajouter des PDFs
          </button>
          {googleDrivePath && (
            <button
              style={{ ...styles.btn, ...styles.driveBtn }}
              onClick={() => addPdfs(googleDrivePath)}
              disabled={busy}
              title={`Ouvrir depuis Google Drive (${googleDrivePath})`}
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
        {isMerging ? "Fusion…" : "⚙ Générer PDF"}
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
  btnGroup: {
    display: "flex",
    gap: 1,
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
  driveBtn: {
    padding: "6px 10px",
    borderRadius: "0 4px 4px 0",
    background: "#2d6a2d",
    color: "#fff",
    fontSize: 12,
  },
  generateBtn: {
    background: "#c05000",
    color: "#fff",
    fontWeight: 600,
  },
};
