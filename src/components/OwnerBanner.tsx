import { useMergeStore } from "../store/useMergeStore";
import type { OwnerInfo } from "../types";

/** Deduplicates owners by code across all PDF items in the store. */
function useDetectedOwners(): OwnerInfo[] {
  const items = useMergeStore((s) => s.items);
  const seen = new Map<string, OwnerInfo>();
  for (const item of items) {
    if (item.type !== "pdf" || !item.owners) continue;
    for (const owner of item.owners) {
      if (!seen.has(owner.code)) seen.set(owner.code, owner);
    }
  }
  return Array.from(seen.values());
}

export function OwnerBanner() {
  const owners = useDetectedOwners();

  if (owners.length === 0) return null;

  const isMultiple = owners.length > 1;
  const names = owners.map((o) => o.name).join(" · ");

  return (
    <div
      style={{ ...styles.banner, ...(isMultiple ? styles.bannerMultiple : styles.bannerSingle) }}
    >
      <span style={styles.icon}>{isMultiple ? "⚠" : "✓"}</span>
      <span style={styles.label}>
        {isMultiple ? `${owners.length} copropriétaires : ${names}` : `Copropriétaire : ${names}`}
      </span>
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
    background: "var(--owner-banner-multi-bg, rgba(234,179,8,0.08))",
    borderColor: "var(--owner-banner-multi-border, rgba(234,179,8,0.3))",
    color: "var(--owner-banner-multi-text, #a16207)",
  },
  icon: {
    flexShrink: 0,
    fontSize: 13,
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
