export interface PdfItem {
  id: string;
  type: "pdf";
  pdfPath: string;
}

export interface SlideGroupItem {
  id: string;
  type: "slide-group";
  /** Slide indices in original PPTX order (0-based). */
  slideIndices: number[];
}

export type MergeItem = PdfItem | SlideGroupItem;

export type AppStatus = "idle" | "converting" | "merging" | "error";
