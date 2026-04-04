import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useThumbnail } from "../../hooks/useThumbnail";
import { useDragActive } from "./MergeList";
import type { Rotation } from "../../types";

const ZOOM_W = 480;
const ZOOM_H = 360;
const THUMB_W = 48;
const THUMB_H = 36;

interface Props {
  pdfPath: string | null;
  pageIndex: number;
  alt: string;
  rotation?: Rotation;
}

export function ZoomThumb({ pdfPath, pageIndex, alt, rotation = 0 }: Props) {
  // Render at 600px so 480px zoom is always sharp (downscaled)
  const { url } = useThumbnail(pdfPath, pageIndex, 600);
  const isDragging = useDragActive();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [zoomPos, setZoomPos] = useState<{ top: number; left: number } | null>(null);

  // Close zoom if the window loses focus (e.g. external app opens on double-click)
  useEffect(() => {
    const hide = () => setZoomPos(null);
    window.addEventListener("blur", hide);
    return () => window.removeEventListener("blur", hide);
  }, []);

  // Dismiss zoom immediately when a drag starts
  useEffect(() => {
    if (isDragging) setZoomPos(null);
  }, [isDragging]);

  const handleMouseEnter = () => {
    if (isDragging) return;
    if (!thumbRef.current) return;
    const rect = thumbRef.current.getBoundingClientRect();
    const margin = 12;
    const topAbove = rect.top - ZOOM_H - margin;
    const top = topAbove >= 8 ? topAbove : rect.bottom + margin;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - ZOOM_W / 2),
      window.innerWidth - ZOOM_W - 8
    );
    setZoomPos({ top, left });
  };

  const handleMouseLeave = () => setZoomPos(null);

  return (
    <>
      <div
        ref={thumbRef}
        style={styles.wrap}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {url ? (
          <img src={url} style={styles.thumb} alt={alt} />
        ) : (
          <div style={styles.placeholder} />
        )}
      </div>

      {zoomPos && url && createPortal(
        <div style={{ ...styles.overlay, top: zoomPos.top, left: zoomPos.left }}>
          <img
            src={url}
            style={{
              ...styles.zoomImg,
              transform: `rotate(${rotation}deg)`,
              // For 90°/270° rotations swap displayed dimensions so the rotated
              // image fills the box without overflowing.
              ...(rotation === 90 || rotation === 270
                ? { width: ZOOM_H, height: ZOOM_W }
                : {}),
            }}
            alt={alt}
          />
        </div>,
        document.body
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    width: THUMB_W,
    height: THUMB_H,
    flexShrink: 0,
    borderRadius: 3,
    overflow: "hidden",
    cursor: "default",
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    objectFit: "cover",
    borderRadius: 3,
    display: "block",
  },
  placeholder: {
    width: THUMB_W,
    height: THUMB_H,
    background: "#2a3a4a",
    borderRadius: 3,
  },
  overlay: {
    position: "fixed",
    zIndex: 9999,
    background: "#111",
    borderRadius: 8,
    padding: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
    pointerEvents: "none",
  },
  zoomImg: {
    width: ZOOM_W,
    height: ZOOM_H,
    objectFit: "contain",
    borderRadius: 4,
    display: "block",
  },
};
