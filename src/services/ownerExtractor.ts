import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import { detectPageRotation, ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { Rotation } from "../types";
import { PageTimer, buildFileMetric, type FileMetric, type PageMetric } from "../utils/metrics";

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
  /** Per-page timing breakdown — used for performance benchmarking, see src/utils/metrics.ts. */
  fileMetric: FileMetric;
}

export interface ExtractOwnersOptions {
  detectOwners: boolean;
  detectRotation: boolean;
}

const DEFAULT_EXTRACT_OPTIONS: ExtractOwnersOptions = { detectOwners: true, detectRotation: true };

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

    // Real owner blocks have at most a street line and a postal-code line between the
    // code and the name. An unbounded skip here lets an unrelated accounting table (one
    // that merely mentions "Copropriétaires" as a category, with every row starting with
    // an account-code digit) walk all the way down to a "Total" row and misreport it as
    // the owner name — cap the skip so that case fails the match instead.
    const MAX_NAME_LINE_SKIP = 3;
    const skipLimit = Math.min(orderedLines.length, nameLineIndex + MAX_NAME_LINE_SKIP);
    while (nameLineIndex < skipLimit && /^\d/.test(orderedLines[nameLineIndex])) {
      nameLineIndex++;
    }
    if (nameLineIndex >= skipLimit) continue;

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

  // The /Rotate page attribute is a clockwise display rotation. A text item's
  // baseline transform angle `dominant` is measured counter-clockwise (standard
  // math convention, since PDF user space is y-up). Rotating the page clockwise
  // by `dominant` degrees brings that baseline back to 0° (upright), so the
  // correction is `dominant` itself — NOT its 360-complement.
  return dominant as Rotation;
}

/** Maximum time to wait for pdfjs to load a single PDF before giving up. */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * Returns owners found across all pages of a PDF, with per-page attribution.
 * Returns empty owners/pageOwners when no owner pattern is detected.
 * Throws if the PDF fails to load or doesn't load within LOAD_TIMEOUT_MS.
 */
export async function extractOwners(
  pdfPath: string,
  options: ExtractOwnersOptions = DEFAULT_EXTRACT_OPTIONS
): Promise<ExtractionResult> {
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

  const pageMetrics: PageMetric[] = [];
  const fileStart = performance.now();

  try {
    const found = new Map<string, OwnerInfo>();
    const pageOwners = new Map<number, OwnerInfo>();
    const pageRotationCorrections = new Map<number, Rotation>();
    let currentOwner: OwnerInfo | null = null;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const pageStart = performance.now();
      const timer = new PageTimer();
      let usedOcrForOwner = false;
      let usedOcrForRotation = false;

      const page = await pdf.getPage(pageNum);
      const content = await timer.measure("textExtractMs", () => page.getTextContent());
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
        if (options.detectOwners) {
          owner = timer.measureSync("ownerParseMs", () => parseOwner(buildLines(content.items)));
        }

        let rotationCorrection: Rotation = 0;
        if (options.detectRotation) {
          rotationCorrection = timer.measureSync("textRotationDetectMs", () =>
            detectTextRotation(content.items)
          );
          console.info(
            `[extractOwners] page ${pageNum}: detectTextRotation=${rotationCorrection}°`
          );
          if (rotationCorrection !== 0) pageRotationCorrections.set(pageNum, rotationCorrection);
        }

        if (options.detectOwners && !owner) {
          // Text is embedded but no owner pattern matched (either the owner block is an
          // image, or the text is rotated and buildLines() can't reconstruct line order).
          // OCR fallback at the detected rotation (0 when detectRotation is off).
          usedOcrForOwner = true;
          const { text: cropText } = await timer.measure("ocrOwnerMs", () =>
            ocrPageWithAutoRotation(page, (text) => matchOwner(toLines(text)) !== null)
          );
          owner = matchOwner(toLines(cropText));
          if (!owner) {
            const fullText = await timer.measure("ocrOwnerMs", () =>
              ocrPage(page, "full", rotationCorrection)
            );
            owner = matchOwner(toLines(fullText));
          }
        }
      } else {
        let rotationCorrection: Rotation = 0;
        // Set when the owner-crop OCR sweep below finds the owner directly (no full-page
        // fallback needed) — its rotation reading is then trustworthy enough to reuse for
        // page rotation, skipping a second redundant 4-rotation OCR sweep in detectPageRotation.
        let ownerSweepRotation: Rotation | null = null;

        if (options.detectOwners) {
          // Don't rely on `rotationCorrection` here — it's only computed below when
          // detectRotation is enabled, and stays 0 otherwise. Search rotations ourselves
          // (same as the hasText branch) so owner detection works on rotated scans
          // independently of the rotation toggle.
          usedOcrForOwner = true;
          const { text: cropText, rotationCorrection: ocrRotation } = await timer.measure(
            "ocrOwnerMs",
            () => ocrPageWithAutoRotation(page, (text) => matchOwner(toLines(text)) !== null)
          );
          owner = matchOwner(toLines(cropText));
          if (owner) {
            ownerSweepRotation = ocrRotation;
          } else {
            const fullText = await timer.measure("ocrOwnerMs", () =>
              ocrPage(page, "full", ocrRotation)
            );
            owner = matchOwner(toLines(fullText));
          }
        }

        if (options.detectRotation) {
          // Only run OCR-based rotation detection for pages with no /Rotate metadata (i.e.
          // page.rotate === 0). Pages that already have /Rotate set by the PDF creator are
          // rendered correctly by pdfjs natively — applying an additional correction would
          // compound or destroy the existing rotation (e.g. /Rotate:270 + detected 90° = 0°).
          if ((page.rotate ?? 0) === 0) {
            if (ownerSweepRotation !== null) {
              rotationCorrection = ownerSweepRotation;
            } else {
              usedOcrForRotation = true;
              rotationCorrection = await timer.measure("ocrRotationDetectMs", () =>
                detectPageRotation(page)
              );
            }
          }
          console.info(
            `[extractOwners] page ${pageNum}: detectPageRotation=${rotationCorrection}° (page.rotate=${page.rotate})`
          );
          if (rotationCorrection !== 0) pageRotationCorrections.set(pageNum, rotationCorrection);
        }
      }

      if (owner) {
        if (!found.has(owner.code)) found.set(owner.code, owner);
        currentOwner = found.get(owner.code)!;
      }
      if (currentOwner) {
        pageOwners.set(pageNum, currentOwner);
      }

      pageMetrics.push({
        pageNum,
        hasText,
        usedOcrForOwner,
        usedOcrForRotation,
        textExtractMs: timer.getMs("textExtractMs"),
        ownerParseMs: timer.getMs("ownerParseMs"),
        textRotationDetectMs: timer.getMs("textRotationDetectMs"),
        ocrRotationDetectMs: timer.getMs("ocrRotationDetectMs"),
        ocrOwnerMs: timer.getMs("ocrOwnerMs"),
        totalMs: performance.now() - pageStart,
      });
    }

    return {
      owners: Array.from(found.values()),
      pageOwners,
      pageRotationCorrections,
      fileMetric: buildFileMetric(pdfPath, pageMetrics, performance.now() - fileStart),
    };
  } finally {
    await pdf.destroy();
  }
}
