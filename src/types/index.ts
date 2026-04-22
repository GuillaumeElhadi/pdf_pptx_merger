import type { OwnerInfo } from "../services/ownerExtractor";

export type { OwnerInfo };

export type Rotation = 0 | 90 | 180 | 270;

export interface PdfItem {
  id: string;
  type: "pdf";
  pdfPath: string;
  rotation: Rotation;
  /**
   * Owners detected in this PDF's pages.
   * undefined  = extraction not yet run
   * []         = portrait PDF, or landscape with no Copropriétaire pattern found
   * [...]      = one or more distinct owners detected
   */
  owners?: OwnerInfo[];
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
