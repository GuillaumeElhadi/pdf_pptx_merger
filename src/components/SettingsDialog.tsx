import { createPortal } from "react-dom";
import { useMergeStore } from "../store/useMergeStore";
import { strings } from "../strings";
import { detectMaxWorkers, workerCountForLevel } from "../utils/performanceSettings";
import { Switch } from "./Switch";
import type { PerformanceLevel } from "../types";

interface Props {
  onClose: () => void;
}

const LEVELS: PerformanceLevel[] = ["economical", "balanced", "performance"];
const LEVEL_INDEX: Record<PerformanceLevel, number> = {
  economical: 0,
  balanced: 1,
  performance: 2,
};

export function SettingsDialog({ onClose }: Props) {
  const {
    ownersDetectionEnabled,
    rotationDetectionEnabled,
    setOwnersDetectionEnabled,
    setRotationDetectionEnabled,
    performanceLevel,
    setPerformanceLevel,
    status,
    pdfPendingCount,
    pptxPendingCount,
  } = useMergeStore();

  const busy = status === "merging" || pdfPendingCount > 0 || pptxPendingCount > 0;
  const maxWorkers = detectMaxWorkers();
  const resolvedWorkers = workerCountForLevel(performanceLevel, maxWorkers);

  return createPortal(
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={strings.settings.title}
      >
        <h2 style={styles.heading}>{strings.settings.title}</h2>

        <Switch
          checked={ownersDetectionEnabled}
          onChange={setOwnersDetectionEnabled}
          disabled={busy}
          label={strings.topBar.ownersToggle}
        />
        <Switch
          checked={rotationDetectionEnabled}
          onChange={setRotationDetectionEnabled}
          disabled={busy}
          label={strings.topBar.rotationToggle}
        />

        <hr style={styles.separator} />

        <div style={styles.perfSection}>
          <span style={styles.perfLabel}>{strings.settings.performanceLabel}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={LEVEL_INDEX[performanceLevel]}
            onChange={(e) => setPerformanceLevel(LEVELS[Number(e.target.value)])}
            style={styles.range}
            aria-label={strings.settings.performanceLabel}
          />
          <div style={styles.perfTicks}>
            <span>{strings.settings.levelEconomical}</span>
            <span>{strings.settings.levelBalanced}</span>
            <span>{strings.settings.levelPerformance}</span>
          </div>
          <p style={styles.perfCaption}>
            {strings.settings.performanceCaption(resolvedWorkers, maxWorkers)}
          </p>
        </div>

        <button style={styles.closeBtn} onClick={onClose}>
          {strings.settings.close}
        </button>
      </div>
    </div>,
    document.body
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    background: "var(--bg-bar)",
    border: "1px solid var(--border-bar)",
    borderRadius: 8,
    padding: 20,
    width: 360,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  heading: {
    margin: 0,
    fontSize: 16,
    color: "var(--text-title)",
  },
  separator: {
    border: "none",
    borderTop: "1px solid var(--border-bar)",
    margin: 0,
  },
  perfSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  perfLabel: {
    fontSize: 12,
    color: "var(--text-title)",
  },
  range: {
    width: "100%",
  },
  perfTicks: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  perfCaption: {
    margin: 0,
    fontSize: 11,
    color: "var(--text-muted)",
  },
  closeBtn: {
    padding: "6px 14px",
    border: "none",
    borderRadius: 4,
    background: "var(--btn-bg)",
    color: "var(--btn-text)",
    cursor: "pointer",
    fontSize: 13,
    alignSelf: "flex-end",
  },
};
