export interface PdfItem {
  id: string;
  type: "pdf";
  pdfPath: string;
}

export interface SlideItem {
  id: string;
  type: "slide";
  /** 0-based index into the converted PPTX PDF. */
  slideIndex: number;
}

export type MergeItem = PdfItem | SlideItem;

export type AppStatus = "idle" | "converting" | "merging" | "error";
