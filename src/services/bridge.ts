import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { logger } from "../utils/logger";

const PPTX_FILTER = [{ name: "PowerPoint", extensions: ["pptx", "ppt"] }];
const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  logger.info("Bridge", `→ ${command}${args ? " " + JSON.stringify(args) : ""}`);
  try {
    const result = await invoke<T>(command, args);
    logger.info("Bridge", `← ${command} OK`);
    return result;
  } catch (e) {
    logger.error(`Bridge:${command}`, e);
    throw e;
  }
}

export const Bridge = {
  /** Convert PPTX to a single merged PDF. Returns the output PDF path. */
  convertPptx: (pptxPath: string): Promise<string> =>
    call("convert_pptx", { pptxPath }),

  /** Number of pages in a PDF without splitting. */
  getPdfPageCount: (pdfPath: string): Promise<number> =>
    call("get_pdf_page_count", { pdfPath }),

  /** Returns the app temp directory path (for loading local files in pdfjs). */
  getTempDir: (): Promise<string> => call("get_temp_dir"),

  // ── File dialogs ──────────────────────────────────────────────────────────

  pickPptxFile: (defaultPath?: string): Promise<string | null> =>
    open({ multiple: false, filters: PPTX_FILTER, defaultPath }) as Promise<string | null>,

  pickPdfFiles: (defaultPath?: string): Promise<string[] | null> =>
    open({ multiple: true, filters: PDF_FILTER, defaultPath }) as Promise<string[] | null>,

  pickSaveLocation: (): Promise<string | null> =>
    save({ defaultPath: "merged.pdf", filters: PDF_FILTER }),

  getGoogleDrivePath: (): Promise<string | null> =>
    call("get_google_drive_path"),

  extractPdfPage: (pdfPath: string, pageIndex: number): Promise<string> =>
    call("extract_pdf_page", { pdfPath, pageIndex }),

  openFile: (path: string): Promise<void> =>
    openPath(path).catch((e) => {
      logger.error("Bridge:openFile", e);
      throw e;
    }),
};
