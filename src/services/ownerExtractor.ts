import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { Rotation } from "../types";

export interface OwnerInfo {
  code: string; // e.g. "0000001"
  name: string; // e.g. "S.A.S. IMMO. CARREFOUR"
}

export interface ExtractionResult {
  /** Distinct owners found across all pages. */
  owners: OwnerInfo[];
  /** 1-based page number → owner. Pages absent from the map are orphans (included in all outputs). */
  pageOwners: Map<number, OwnerInfo>;
  /** 1-based page → rotation correction (degrees). Only non-zero entries stored. */
  pageRotationCorrections: Map<number, Rotation>;
}

// Minimal shape we use from pdfjs TextItem
interface PdfTextItem {
  str: string;
  transform: number[]; // affine matrix — transform[5] is the y position
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof (item as PdfTextItem).str === "string" && Array.isArray((item as PdfTextItem).transform)
  );
}

interface Line {
  y: number;
  text: string;
}

/** Groups text items into lines by rounding their y coordinate, sorted top-to-bottom. */
function buildLines(items: unknown[]): Line[] {
  const buckets = new Map<number, string[]>();

  for (const item of items) {
    if (!isPdfTextItem(item) || !item.str.trim()) continue;
    // Round to 4px bucket so items on the same visual line share the same key
    const y = Math.round(item.transform[5] / 4) * 4;
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y)!.push(item.str);
  }

  // Higher y = higher on page in PDF coordinate space → sort descending = top first
  return Array.from(buckets.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([y, parts]) => ({ y, text: parts.join(" ").trim() }));
}

/**
 * Core matching logic operating on plain ordered strings (top-to-bottom).
 * Used by both the text path (via buildLines) and the OCR path (split on '\n').
 */
function matchOwner(orderedLines: string[]): OwnerInfo | null {
  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    if (!/Copropri[eé]taire/i.test(line)) continue;

    let code = line.match(/Copropri[eé]taire\s+(\d{4,})/i)?.[1];
    let nameLineIndex = i + 1;

    if (!code && i + 1 < orderedLines.length) {
      const m = orderedLines[i + 1].match(/^(\d{4,})$/);
      if (m) {
        code = m[1];
        nameLineIndex = i + 2;
      }
    }

    if (!code) continue;

    while (nameLineIndex < orderedLines.length && /^\d/.test(orderedLines[nameLineIndex])) {
      nameLineIndex++;
    }

    const nameLine = orderedLines[nameLineIndex];
    if (!nameLine) continue;

    const name = nameLine.replace(/\s+Exercice\s+du\s+.*$/i, "").trim();
    if (!name) continue;

    return { code, name };
  }

  // Pattern 2: "Edition par Coproprietaire" — owner appears as subtitle after date range line
  for (let i = 0; i < orderedLines.length; i++) {
    if (!/^Du\s+\d{2}\/\d{2}\/\d{4}\s+au\s+\d{2}\/\d{2}\/\d{4}/i.test(orderedLines[i])) continue;

    let nameLineIndex = i + 1;
    while (nameLineIndex < orderedLines.length && /^\d/.test(orderedLines[nameLineIndex])) {
      nameLineIndex++;
    }

    const nameLine = orderedLines[nameLineIndex]?.trim();
    if (!nameLine) continue;

    return { code: nameLine, name: nameLine };
  }

  return null;
}

/** Returns the first OwnerInfo found in the given pdfjs Line sequence, or null. */
function parseOwner(lines: Line[]): OwnerInfo | null {
  return matchOwner(lines.map((l) => l.text));
}

/** Maximum time to wait for pdfjs to load a single PDF before giving up. */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * Returns owners found across all pages of a PDF, with per-page attribution.
 * Returns empty owners/pageOwners when no owner pattern is detected.
 * Throws if the PDF fails to load or doesn't load within LOAD_TIMEOUT_MS.
 */
export async function extractOwners(pdfPath: string): Promise<ExtractionResult> {
  const url = convertFileSrc(pdfPath);
  const loadTask = pdfjsLib.getDocument(url);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      loadTask.destroy().catch(() => {});
      reject(
        new Error(
          `Timeout after ${LOAD_TIMEOUT_MS / 1000}s loading ${pdfPath.split(/[\\/]/).pop()}`
        )
      );
    }, LOAD_TIMEOUT_MS);
  });

  const pdf = await Promise.race([loadTask.promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });

  try {
    const found = new Map<string, OwnerInfo>();
    const pageOwners = new Map<number, OwnerInfo>();
    const pageRotationCorrections = new Map<number, Rotation>();
    let currentOwner: OwnerInfo | null = null;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const hasText = content.items.some((i) => isPdfTextItem(i) && i.str.trim().length > 0);

      let owner: OwnerInfo | null = null;

      if (hasText) {
        owner = parseOwner(buildLines(content.items));
      } else {
        const { text: cropText, rotationCorrection } = await ocrPageWithAutoRotation(page, "crop");
        owner = matchOwner(
          cropText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        );
        if (!owner) {
          const fullText = await ocrPage(page, "full", rotationCorrection);
          owner = matchOwner(
            fullText
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
          );
        }
        if (rotationCorrection !== 0) pageRotationCorrections.set(pageNum, rotationCorrection);
      }

      if (owner) {
        if (!found.has(owner.code)) found.set(owner.code, owner);
        currentOwner = found.get(owner.code)!;
      }
      if (currentOwner) {
        pageOwners.set(pageNum, currentOwner);
      }
    }

    return { owners: Array.from(found.values()), pageOwners, pageRotationCorrections };
  } finally {
    await pdf.destroy();
  }
}
