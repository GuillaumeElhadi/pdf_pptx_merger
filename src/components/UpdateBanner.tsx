import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "done">("idle");

  useEffect(() => {
    check().then(setUpdate).catch(() => {});
  }, []);

  if (!update) return null;

  async function installUpdate() {
    if (!update) return;
    setStatus("downloading");
    await update.downloadAndInstall();
    setStatus("done");
    await relaunch();
  }

  return (
    <div style={styles.banner}>
      <span>
        Nouvelle version disponible : <strong>{update.version}</strong>
      </span>
      <button
        style={styles.btn}
        onClick={installUpdate}
        disabled={status !== "idle"}
      >
        {status === "downloading" ? "Téléchargement…" : "Mettre à jour"}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 16px",
    background: "#1a4a2a",
    borderBottom: "1px solid #4aff8a",
    fontSize: 13,
    color: "#88ffaa",
    flexShrink: 0,
    userSelect: "none",
  },
  btn: {
    background: "#2a6a3a",
    border: "1px solid #4aff8a",
    borderRadius: 4,
    color: "#88ffaa",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 12px",
    flexShrink: 0,
  },
};
