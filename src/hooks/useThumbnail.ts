import { useEffect, useState } from "react";
import { renderPage } from "../services/pdfRenderer";
import type { Rotation } from "../types";

interface ThumbnailState {
  url: string | null;
  loading: boolean;
}

/**
 * Lazily loads and caches a PDF page thumbnail.
 * Returns a PNG object URL once rendered, null while loading.
 */
export function useThumbnail(
  pdfPath: string | null,
  pageIndex: number = 0,
  width: number = 160,
  rotationCorrection: Rotation = 0
): ThumbnailState {
  const [state, setState] = useState<ThumbnailState>({
    url: null,
    loading: !!pdfPath,
  });

  useEffect(() => {
    if (!pdfPath) {
      setState({ url: null, loading: false });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true });

    renderPage(pdfPath, pageIndex, width, rotationCorrection)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPath, pageIndex, width, rotationCorrection]);

  return state;
}
