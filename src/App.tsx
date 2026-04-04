import { TopBar } from "./components/TopBar/TopBar";
import { MergeList } from "./components/MergeList/MergeList";
import { StatusBar } from "./components/StatusBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { useMergeStore } from "./store/useMergeStore";

export default function App() {
  const { selectedIds, clearSelection } = useMergeStore();
  const selectionCount = selectedIds.size;

  return (
    <div style={styles.app}>
      <TopBar />
      <UpdateBanner />

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

      <main style={styles.main}>
        <MergeList />
      </main>

      <StatusBar />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#1e1e1e",
    color: "#ddd",
    fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    overflow: "hidden",
  },
  selectionBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 16px",
    background: "#1a3a5c",
    borderBottom: "1px solid #4a9eff",
    fontSize: 13,
    color: "#88ccff",
    flexShrink: 0,
    userSelect: "none",
  },
  clearBtn: {
    background: "none",
    border: "1px solid #4a7aaa",
    borderRadius: 4,
    color: "#88aacc",
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
