export type Rotation = 0 | 90 | 180 | 270;

export interface PdfItem {
  id: string;
  type: "pdf";
  pdfPath: string;
  rotation: Rotation;
}

export interface SlideItem {
  id: string;
  type: "slide";
  /** 0-based index into the converted PPTX PDF. */
  slideIndex: number;
  rotation: Rotation;
}

export type MergeItem = PdfItem | SlideItem;

export type AppStatus = "idle" | "converting" | "merging" | "error";
