import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const PPTX_FILTER = [{ name: "PowerPoint", extensions: ["pptx", "ppt"] }];
const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];

export const Bridge = {
  /** Convert PPTX to a single merged PDF. Returns the output PDF path. */
  convertPptx: (pptxPath: string): Promise<string> =>
    invoke("convert_pptx", { pptxPath }),

  /** Split a PDF into individual page files. Returns ordered list of paths. */
  splitPdfIntoPages: (pdfPath: string): Promise<string[]> =>
    invoke("split_pdf_into_pages", { pdfPath }),

  /** Number of pages in a PDF without splitting. */
  getPdfPageCount: (pdfPath: string): Promise<number> =>
    invoke("get_pdf_page_count", { pdfPath }),

  /** Merge an ordered list of single-page PDFs into one output file. */
  mergePdfs: (pagePaths: string[], outputPath: string): Promise<void> =>
    invoke("merge_pdfs", { pagePaths, outputPath }),

  /** Returns the app temp directory path (for loading local files in pdfjs). */
  getTempDir: (): Promise<string> => invoke("get_temp_dir"),

  // ── File dialogs ──────────────────────────────────────────────────────────

  pickPptxFile: (): Promise<string | null> =>
    open({ multiple: false, filters: PPTX_FILTER }) as Promise<string | null>,

  pickPdfFiles: (): Promise<string[] | null> =>
    open({ multiple: true, filters: PDF_FILTER }) as Promise<string[] | null>,

  pickSaveLocation: (): Promise<string | null> =>
    save({ defaultPath: "merged.pdf", filters: PDF_FILTER }),
};
