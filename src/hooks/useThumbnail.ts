import { useEffect, useState } from "react";
import { renderPage } from "../services/pdfRenderer";

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
  width: number = 160
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

    renderPage(pdfPath, pageIndex, width)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPath, pageIndex, width]);

  return state;
}
