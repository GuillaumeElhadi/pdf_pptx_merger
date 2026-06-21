import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Label du run courant, utilisé pour nommer les fichiers de métriques.
 * Changer cette valeur manuellement avant chaque run de benchmark
 * (ex: "baseline", "optim-a-dedup-rotation", ...) pour pouvoir comparer
 * les fichiers JSON générés sous <tempDir>/metrics/ entre deux runs.
 */
export const RUN_LABEL = "optim-c-ocr-worker-pool-3";

export interface PageMetric {
  pageNum: number;
  hasText: boolean;
  usedOcrForOwner: boolean;
  usedOcrForRotation: boolean;
  /** page.getTextContent() */
  textExtractMs: number;
  /** buildLines + matchOwner sur le texte embarqué */
  ownerParseMs: number;
  /** detectTextRotation (sync, sur texte embarqué) */
  textRotationDetectMs: number;
  /** detectPageRotation (OCR, pages sans texte) */
  ocrRotationDetectMs: number;
  /** ocrPageWithAutoRotation + fallback full OCR pour le propriétaire */
  ocrOwnerMs: number;
  totalMs: number;
}

export interface FileMetric {
  filePath: string;
  pageCount: number;
  totalMs: number;
  pages: PageMetric[];
}

export interface BatchSummary {
  totalOcrMs: number;
  totalNonOcrMs: number;
  avgMsPerPage: number;
  avgMsPerFile: number;
  pagesUsingOcrOwner: number;
  pagesUsingOcrRotation: number;
  pageCount: number;
}

export interface BatchMetric {
  label: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  fileCount: number;
  files: FileMetric[];
  summary: BatchSummary;
}

/**
 * Accumule la durée de sections nommées pour une page, sans changer le flot
 * de contrôle existant. `now` est injectable pour les tests.
 */
export class PageTimer {
  private sections = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  async measure<T>(section: string, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.add(section, this.now() - start);
    }
  }

  measureSync<T>(section: string, fn: () => T): T {
    const start = this.now();
    const result = fn();
    this.add(section, this.now() - start);
    return result;
  }

  getMs(section: string): number {
    return this.sections.get(section) ?? 0;
  }

  private add(section: string, delta: number) {
    this.sections.set(section, (this.sections.get(section) ?? 0) + delta);
  }
}

export function buildFileMetric(
  filePath: string,
  pages: PageMetric[],
  totalMs: number
): FileMetric {
  return { filePath, pageCount: pages.length, totalMs, pages };
}

const OCR_FIELDS = ["ocrRotationDetectMs", "ocrOwnerMs"] as const;
const NON_OCR_FIELDS = ["textExtractMs", "ownerParseMs", "textRotationDetectMs"] as const;

export function summarizeBatch(files: FileMetric[]): BatchSummary {
  let totalOcrMs = 0;
  let totalNonOcrMs = 0;
  let pagesUsingOcrOwner = 0;
  let pagesUsingOcrRotation = 0;
  let pageCount = 0;
  let totalPageMs = 0;

  for (const file of files) {
    for (const page of file.pages) {
      pageCount++;
      totalPageMs += page.totalMs;
      for (const field of OCR_FIELDS) totalOcrMs += page[field];
      for (const field of NON_OCR_FIELDS) totalNonOcrMs += page[field];
      if (page.usedOcrForOwner) pagesUsingOcrOwner++;
      if (page.usedOcrForRotation) pagesUsingOcrRotation++;
    }
  }

  return {
    totalOcrMs,
    totalNonOcrMs,
    avgMsPerPage: pageCount > 0 ? totalPageMs / pageCount : 0,
    avgMsPerFile: files.length > 0 ? files.reduce((s, f) => s + f.totalMs, 0) / files.length : 0,
    pagesUsingOcrOwner,
    pagesUsingOcrRotation,
    pageCount,
  };
}

/**
 * Écrit le batch de métriques en JSON sous `<tempDir>/metrics/<label>-<timestamp>.json`.
 * Retourne le chemin écrit pour permettre de le logger.
 */
export async function saveMetrics(batch: BatchMetric, tempDir: string): Promise<string> {
  const metricsDir = `${tempDir}/metrics`;
  await mkdir(metricsDir, { recursive: true });

  const safeTimestamp = batch.startedAt.replace(/[:.]/g, "-");
  const path = `${metricsDir}/${batch.label}-${safeTimestamp}.json`;

  await writeTextFile(path, JSON.stringify(batch, null, 2));
  return path;
}
