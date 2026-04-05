import { Update } from "@tauri-apps/plugin-updater";
import { UpdateStatus } from "../hooks/useUpdater";

interface Props {
  update: Update | null;
  status: UpdateStatus;
  dismissed: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ update, status, dismissed, onInstall, onDismiss }: Props) {
  if (!update || dismissed) return null;

  return (
    <div style={styles.banner}>
      <span>
        Nouvelle version disponible : <strong>{update.version}</strong>
      </span>
      <div style={styles.actions}>
        <button style={styles.dismissBtn} onClick={onDismiss} disabled={status !== "idle"}>
          Plus tard
        </button>
        <button style={styles.btn} onClick={onInstall} disabled={status !== "idle"}>
          {status === "downloading" ? "Téléchargement…" : "Mettre à jour"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 16px",
    background: "var(--update-bg)",
    borderBottom: "1px solid var(--update-border)",
    fontSize: 13,
    color: "var(--update-text)",
    flexShrink: 0,
    userSelect: "none",
  },
  actions: {
    display: "flex",
    gap: 8,
  },
  dismissBtn: {
    background: "none",
    border: "1px solid var(--update-border)",
    borderRadius: 4,
    color: "var(--update-text)",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 12px",
    flexShrink: 0,
    opacity: 0.7,
  },
  btn: {
    background: "var(--update-btn-bg)",
    border: "1px solid var(--update-border)",
    borderRadius: 4,
    color: "var(--update-text)",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 12px",
    flexShrink: 0,
  },
};
