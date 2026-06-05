import * as pdfjsLib from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface OwnerInfo {
  code: string; // e.g. "0000001"
  name: string; // e.g. "S.A.S. IMMO. CARREFOUR"
}

export interface ExtractionResult {
  /** Distinct owners found across all pages. */
  owners: OwnerInfo[];
  /** 1-based page number → owner. Pages absent from the map are orphans (included in all outputs). */
  pageOwners: Map<number, OwnerInfo>;
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

/** Returns the first OwnerInfo found in the given line sequence, or null. */
function parseOwner(lines: Line[]): OwnerInfo | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/Copropri[eé]taire/i.test(lines[i].text)) continue;

    // Code may be on the same line as the label — must follow the keyword, not precede it
    let code = lines[i].text.match(/Copropri[eé]taire\s+(\d{4,})/i)?.[1];
    let nameLineIndex = i + 1;

    // Or the code may be alone on the very next line
    if (!code && i + 1 < lines.length) {
      const m = lines[i + 1].text.match(/^(\d{4,})$/);
      if (m) {
        code = m[1];
        nameLineIndex = i + 2;
      }
    }

    if (!code) continue;

    // Skip address/postal-code lines (they start with a digit: "93 Avenue de Paris", "91 3 00 MASSY")
    while (nameLineIndex < lines.length && /^\d/.test(lines[nameLineIndex].text)) {
      nameLineIndex++;
    }

    const nameLine = lines[nameLineIndex];
    if (!nameLine?.text) continue;

    // Strip right-column budget period text that pdf.js merges onto the same y as the name
    const name = nameLine.text.replace(/\s+Exercice\s+du\s+.*$/i, "").trim();
    if (!name) continue;

    return { code, name };
  }
  return null;
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

    const filename = pdfPath.split(/[\\/]/).pop();
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const lines = buildLines(content.items);
      const owner = parseOwner(lines);
      if (owner) {
        if (!found.has(owner.code)) found.set(owner.code, owner);
        pageOwners.set(pageNum, found.get(owner.code)!);
      } else {
        // Log raw lines for any page that contains "copro" but didn't match —
        // this reveals encoding differences, unexpected splits, or alternate labels.
        const suspectLines = lines.filter((l) => /copro/i.test(l.text));
        if (suspectLines.length > 0) {
          console.warn(
            `[extractOwners] ${filename} p.${pageNum} — "copro" trouvé mais pas matché :`,
            suspectLines.map((l) => ({
              y: l.y,
              text: l.text,
              repr: [...l.text]
                .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
                .join(""),
            }))
          );
        }
      }
    }

    return { owners: Array.from(found.values()), pageOwners };
  } finally {
    await pdf.destroy();
  }
}
