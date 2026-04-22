import { TopBar } from "./components/TopBar/TopBar";
import { MergeList } from "./components/MergeList/MergeList";
import { OwnerBanner } from "./components/OwnerBanner";
import { StatusBar } from "./components/StatusBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { useMergeStore } from "./store/useMergeStore";
import { ThemeContext, useThemeProvider } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";

export default function App() {
  const { selectedIds, clearSelection } = useMergeStore();
  const selectionCount = selectedIds.size;
  const themeValue = useThemeProvider();
  const { update, currentVersion, status, dismissed, dismiss, undismiss, install } = useUpdater();

  return (
    <ThemeContext.Provider value={themeValue}>
      <div style={styles.app}>
        <TopBar />
        <UpdateBanner
          update={update}
          status={status}
          dismissed={dismissed}
          onInstall={install}
          onDismiss={dismiss}
        />

        {selectionCount > 1 && (
          <div style={styles.selectionBanner}>
            <span>
              {selectionCount} éléments sélectionnés — déplacez l'un pour les déplacer tous
            </span>
            <button style={styles.clearBtn} onClick={clearSelection}>
              Désélectionner
            </button>
          </div>
        )}

        <OwnerBanner />

        <main style={styles.main}>
          <MergeList />
        </main>

        <StatusBar update={update} currentVersion={currentVersion} onUpdateClick={undismiss} />
      </div>
    </ThemeContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--bg-app)",
    color: "var(--text-primary)",
    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    overflow: "hidden",
  },
  selectionBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 16px",
    background: "var(--selection-bg)",
    borderBottom: "1px solid var(--selection-border)",
    fontSize: 13,
    color: "var(--selection-text)",
    flexShrink: 0,
    userSelect: "none",
  },
  clearBtn: {
    background: "none",
    border: "1px solid var(--selection-border)",
    borderRadius: 4,
    color: "var(--selection-text)",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 10px",
    flexShrink: 0,
  },
  main: {
    flex: 1,
    overflowY: "auto",
  },
};
