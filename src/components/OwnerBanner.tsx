import { useState } from "react";
import { useMergeStore } from "../store/useMergeStore";
import type { OwnerInfo } from "../types";

/** Deduplicates owners by name across all PDF items in the store. */
function useDetectedOwners(): OwnerInfo[] {
  const items = useMergeStore((s) => s.items);
  const seen = new Map<string, OwnerInfo>();
  for (const item of items) {
    if (item.type !== "pdf" || !item.owners) continue;
    for (const owner of item.owners) {
      if (!seen.has(owner.name)) seen.set(owner.name, owner);
    }
  }
  return Array.from(seen.values());
}

export function OwnerBanner() {
  const owners = useDetectedOwners();
  const [expanded, setExpanded] = useState(true);

  if (owners.length === 0) return null;

  const isMultiple = owners.length > 1;

  if (!isMultiple) {
    return (
      <div style={{ ...styles.banner, ...styles.bannerSingle }}>
        <span style={styles.icon}>✓</span>
        <span>Copropriétaire : {owners[0].name}</span>
      </div>
    );
  }

  return (
    <div style={{ ...styles.banner, ...styles.bannerMultiple }}>
      <span style={{ ...styles.icon, lineHeight: "20px" }}>⚠</span>
      <div style={styles.multiContent}>
        <button
          style={styles.headlineBtn}
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Réduire" : "Développer"}
        >
          <span>{owners.length} copropriétaires</span>
          <span style={styles.chevron}>{expanded ? "▲" : "▼"}</span>
        </button>
        {expanded && (
          <div style={styles.chips}>
            {owners.map((o) => (
              <span key={o.name} style={styles.chip}>
                {o.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 16px",
    borderBottom: "1px solid",
    fontSize: 12,
    flexShrink: 0,
    userSelect: "none",
  },
  bannerSingle: {
    background: "var(--owner-banner-single-bg, rgba(34,197,94,0.08))",
    borderColor: "var(--owner-banner-single-border, rgba(34,197,94,0.25))",
    color: "var(--owner-banner-single-text, #16a34a)",
  },
  bannerMultiple: {
    alignItems: "flex-start",
    padding: "6px 16px",
    background: "var(--owner-banner-multi-bg, rgba(234,179,8,0.08))",
    borderColor: "var(--owner-banner-multi-border, rgba(234,179,8,0.3))",
    color: "var(--owner-banner-multi-text, #a16207)",
  },
  icon: {
    flexShrink: 0,
    fontSize: 13,
  },
  multiContent: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  headlineBtn: {
    background: "none",
    border: "none",
    color: "inherit",
    fontSize: "inherit",
    padding: 0,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 600,
    userSelect: "none",
  },
  chevron: {
    fontSize: 9,
    opacity: 0.7,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: "3px 6px",
  },
  chip: {
    background: "rgba(0,0,0,0.08)",
    borderRadius: 3,
    padding: "1px 6px",
    fontSize: 11,
    userSelect: "text",
  },
};
