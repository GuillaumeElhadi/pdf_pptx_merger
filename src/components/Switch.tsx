interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

export function Switch({ checked, onChange, disabled = false, label }: Props) {
  return (
    <label style={styles.toggleLabel}>
      <span style={switchTrackStyle(checked, disabled)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={styles.switchInput}
        />
        <span style={switchThumbStyle(checked)} />
      </span>
      {label}
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
