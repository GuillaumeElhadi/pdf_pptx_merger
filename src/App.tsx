import { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar/TopBar";
import { MergeList } from "./components/MergeList/MergeList";
import { SlidePicker } from "./components/SlidePicker/SlidePicker";
import { StatusBar } from "./components/StatusBar";

type PickerState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; id: string };

export default function App() {
  const [picker, setPicker] = useState<PickerState>({ open: false });

  useEffect(() => {
    const handler = (e: Event) => {
      const { mode, id } = (e as CustomEvent).detail;
      if (mode === "create") {
        setPicker({ open: true, mode: "create" });
      } else {
        setPicker({ open: true, mode: "edit", id });
      }
    };
    window.addEventListener("open-slide-picker", handler);
    return () => window.removeEventListener("open-slide-picker", handler);
  }, []);

  return (
    <div style={styles.app}>
      <TopBar />

      <main style={styles.main}>
        <MergeList />
      </main>

      <StatusBar />

      {picker.open && (
        <SlidePicker
          mode={picker.mode}
          editId={picker.mode === "edit" ? picker.id : undefined}
          onClose={() => setPicker({ open: false })}
        />
      )}
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
  main: {
    flex: 1,
    overflowY: "auto",
  },
};
