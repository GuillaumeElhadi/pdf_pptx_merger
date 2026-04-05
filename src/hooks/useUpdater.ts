import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export type UpdateStatus = "idle" | "downloading" | "done";

export interface UseUpdaterResult {
  update: Update | null;
  currentVersion: string;
  status: UpdateStatus;
  dismissed: boolean;
  dismiss: () => void;
  undismiss: () => void;
  install: () => Promise<void>;
}

export function useUpdater(): UseUpdaterResult {
  const [update, setUpdate] = useState<Update | null>(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
    check().then(setUpdate).catch(() => {});
  }, []);

  async function install() {
    if (!update) return;
    setStatus("downloading");
    await update.downloadAndInstall();
    setStatus("done");
    await relaunch();
  }

  return {
    update,
    currentVersion,
    status,
    dismissed,
    dismiss: () => setDismissed(true),
    undismiss: () => setDismissed(false),
    install,
  };
}
