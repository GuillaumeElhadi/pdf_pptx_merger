import { useThumbnail } from "../../hooks/useThumbnail";

type State = "available" | "selected" | "used";

interface Props {
  pdfPath: string | null;
  pageIndex: number;
  slideNumber: number; // 1-based for display
  state: State;
  onToggle: () => void;
}

export function SlideThumb({ pdfPath, pageIndex, slideNumber, state, onToggle }: Props) {
  const { url, loading } = useThumbnail(pdfPath, pageIndex, 160);
  const disabled = state === "used";

  return (
    <div
      style={{
        ...styles.card,
        ...(state === "selected" ? styles.selected : {}),
        ...(state === "used" ? styles.used : {}),
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onClick={disabled ? undefined : onToggle}
      title={disabled ? "Already used in another group" : `Slide ${slideNumber}`}
    >
      <div style={styles.thumb}>
        {loading && <div style={styles.placeholder} />}
        {url && (
          <img
            src={url}
            style={{ ...styles.img, opacity: disabled ? 0.35 : 1 }}
            alt={`Slide ${slideNumber}`}
          />
        )}
        {state === "selected" && <div style={styles.checkmark}>✓</div>}
        {state === "used" && <div style={styles.lockBadge}>🔒</div>}
      </div>
      <span style={{ ...styles.label, color: disabled ? "#555" : "#aaa" }}>
        Slide {slideNumber}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: 6,
    borderRadius: 6,
    border: "2px solid transparent",
    background: "#2a2a2a",
    transition: "border-color 0.1s, background 0.1s",
  },
  selected: {
    borderColor: "#4a9eff",
    background: "#1a3050",
  },
  used: {
    background: "#1e1e1e",
  },
  thumb: {
    position: "relative",
    width: 120,
    height: 90,
    borderRadius: 4,
    overflow: "hidden",
    background: "#333",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    background: "#333",
  },
  img: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  checkmark: {
    position: "absolute",
    top: 4,
    right: 6,
    color: "#4a9eff",
    fontWeight: 700,
    fontSize: 18,
    textShadow: "0 0 4px #000",
  },
  lockBadge: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    fontSize: 24,
  },
  label: {
    fontSize: 11,
  },
};
