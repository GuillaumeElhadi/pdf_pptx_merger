import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { detectPageRotation, ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { Rotation } from "../types";

export interface OwnerInfo {
  code: string; // e.g. "0000001"
  name: string; // e.g. "IMMO CARREFOUR"
}

/**
 * Normalizes a raw owner name extracted from a PDF:
 * 1. Strips a leading juridical form (S.A.S., S.A., S.A.R.L., …) — uppercase letters 1–3 chars separated by dots
 * 2. Removes all remaining dots
 * 3. Removes leading non-alphanumeric characters (e.g. a stray leading hyphen from some PDFs)
 * 4. Trims surrounding whitespace
 *
 * Examples:
 *   "S.A.S. CARREFOUR HYPER." → "CARREFOUR HYPER"
 *   "S.A. CONFORAMA  DEVELLOPPEMENT 12" → "CONFORAMA  DEVELLOPPEMENT 12"
 *   "IMMO. CARREFOUR" → "IMMO CARREFOUR"
 *   "-GHESQUIERE" → "GHESQUIERE"
 */
export function normalizeName(raw: string): string {
  return raw
    .replace(/^(?:[A-Z]{1,3}\.)+\s*/g, "")
    .replace(/\./g, "")
    .replace(/^[^a-zA-ZÀ-ÿ0-9]+/, "")
    .trim()
    .replace(/\s+/g, " ");
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

    return { code, name: normalizeName(name) };
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

    const normalizedName = normalizeName(nameLine);
    return { code: normalizedName, name: normalizedName };
  }

  // Pattern 3: "Référence :" marker (Carrefour Property Gestion "relevé individuel de charges") —
  // recipient name appears on the line just before "Référence :".
  for (let i = 1; i < orderedLines.length; i++) {
    if (!/R[eé]f[eé]rence\s*:/i.test(orderedLines[i])) continue;

    let nameLineIndex = i - 1;
    // Skip numeric address lines AND labeled fields ("Arrêté : date", "Date : ...", etc.)
    while (
      nameLineIndex >= 0 &&
      (/^\d/.test(orderedLines[nameLineIndex]) || orderedLines[nameLineIndex].includes(":"))
    ) {
      nameLineIndex--;
    }

    if (nameLineIndex < 0) continue;

    const nameLine = orderedLines[nameLineIndex]?.trim();
    if (!nameLine) continue;

    const normalizedName = normalizeName(nameLine);
    if (!normalizedName) continue;
    // Reject OCR artifacts: company names are all-uppercase and contain no slashes.
    // Mixed/lowercase text ("gestior", "Carrefour Property Gestion 8") and pagination
    // fragments ("s/11") are noise. A trailing isolated letter signals a truncated
    // document title ("RELEVE PROVISOIRE D" = "RELEVÉ PROVISOIRE DE CHARGES…").
    if (/[a-z]/.test(normalizedName)) continue;
    if (normalizedName.includes("/")) continue;
    if (/ [A-Z]$/.test(normalizedName)) continue;

    return { code: normalizedName, name: normalizedName };
  }

  return null;
}

/** Returns the first OwnerInfo found in the given pdfjs Line sequence, or null. */
function parseOwner(lines: Line[]): OwnerInfo | null {
  return matchOwner(lines.map((l) => l.text));
}

/**
 * Detects the dominant text direction from pdfjs text item transforms.
 *
 * Each item's transform `[a, b, ...]` encodes text direction via atan2(b, a).
 * Returns the rotation correction (0|90|180|270) needed to make text upright,
 * or 0 when:
 *   - fewer than 3 non-empty items (too sparse to determine reliably)
 *   - the dominant angle is 0° (already upright)
 *   - no single angle accounts for ≥50% of items (mixed/unreliable)
 */
function detectTextRotation(items: unknown[]): Rotation {
  const angleCounts = new Map<number, number>();
  let total = 0;

  for (const item of items) {
    if (!isPdfTextItem(item) || !item.str.trim()) continue;
    const [a, b] = item.transform;
    if (a === 0 && b === 0) continue;

    const angleDeg = Math.atan2(b, a) * (180 / Math.PI);
    const bucketed = Math.round(angleDeg / 90) * 90;
    const normalized = ((bucketed % 360) + 360) % 360;
    angleCounts.set(normalized, (angleCounts.get(normalized) ?? 0) + 1);
    total++;
  }

  if (total < 3) return 0;

  const [dominant, count] = [...angleCounts.entries()].sort((x, y) => y[1] - x[1])[0];

  if (dominant === 0 || count / total < 0.5) return 0;

  return ((360 - dominant) % 360) as Rotation;
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

      const toLines = (text: string) =>
        text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

      console.info(
        `[extractOwners] page ${pageNum}: hasText=${hasText} page.rotate=${page.rotate}`
      );

      if (hasText) {
        owner = parseOwner(buildLines(content.items));
        const rotationCorrection = detectTextRotation(content.items);
        console.info(`[extractOwners] page ${pageNum}: detectTextRotation=${rotationCorrection}°`);
        if (rotationCorrection !== 0) {
          pageRotationCorrections.set(pageNum, rotationCorrection);
          if (!owner) {
            // Rotated text: buildLines() can't reconstruct visual line order → fall back to OCR
            const { text: cropText } = await ocrPageWithAutoRotation(
              page,
              (text) => matchOwner(toLines(text)) !== null
            );
            owner = matchOwner(toLines(cropText));
            if (!owner) {
              const fullText = await ocrPage(page, "full", rotationCorrection);
              owner = matchOwner(toLines(fullText));
            }
          }
        } else if (!owner) {
          // Hybrid page: some text is embedded (enough to make hasText=true) but the
          // owner content is rendered as image (e.g. "Print to PDF" documents where the
          // recipient block is a graphic). Fall back to OCR the same way as image-only pages.
          const { text: cropText } = await ocrPageWithAutoRotation(
            page,
            (text) => matchOwner(toLines(text)) !== null
          );
          owner = matchOwner(toLines(cropText));
          if (!owner) {
            const fullText = await ocrPage(page, "full", 0);
            owner = matchOwner(toLines(fullText));
          }
        }
      } else {
        // Only run OCR-based rotation detection for pages with no /Rotate metadata (i.e.
        // page.rotate === 0). Pages that already have /Rotate set by the PDF creator are
        // rendered correctly by pdfjs natively — applying an additional correction would
        // compound or destroy the existing rotation (e.g. /Rotate:270 + detected 90° = 0°).
        const rotationCorrection = (page.rotate ?? 0) === 0 ? await detectPageRotation(page) : 0;
        console.info(
          `[extractOwners] page ${pageNum}: detectPageRotation=${rotationCorrection}° (page.rotate=${page.rotate})`
        );

        // Try to find the owner at the detected orientation.
        const cropText = await ocrPage(page, "crop", rotationCorrection);
        owner = matchOwner(toLines(cropText));
        if (!owner) {
          const fullText = await ocrPage(page, "full", rotationCorrection);
          owner = matchOwner(toLines(fullText));
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
