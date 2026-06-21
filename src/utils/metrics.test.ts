/**
 * Tests pour metrics.ts — instrumentation de performance pour
 * ownerExtractor/processPdfItems (benchmark avant/après optimisation).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PageTimer,
  buildFileMetric,
  summarizeBatch,
  saveMetrics,
  type FileMetric,
} from "./metrics";

// ── PageTimer ────────────────────────────────────────────────────────────────

describe("PageTimer", () => {
  it("measure() accumule la durée d'une section async", async () => {
    let t = 0;
    const timer = new PageTimer(() => t);

    await timer.measure("ocrOwner", async () => {
      t += 50;
      return "result";
    });

    expect(timer.getMs("ocrOwner")).toBe(50);
  });

  it("measureSync() accumule la durée d'une section sync", () => {
    let t = 0;
    const timer = new PageTimer(() => t);

    timer.measureSync("ownerParse", () => {
      t += 5;
      return "x";
    });

    expect(timer.getMs("ownerParse")).toBe(5);
  });

  it("measure() additionne plusieurs appels à la même section", async () => {
    let t = 0;
    const timer = new PageTimer(() => t);

    await timer.measure("ocrOwner", async () => {
      t += 10;
    });
    await timer.measure("ocrOwner", async () => {
      t += 20;
    });

    expect(timer.getMs("ocrOwner")).toBe(30);
  });

  it("getMs() d'une section jamais mesurée vaut 0", () => {
    const timer = new PageTimer(() => 0);
    expect(timer.getMs("never")).toBe(0);
  });

  it("measure() propage la durée même si fn() rejette", async () => {
    let t = 0;
    const timer = new PageTimer(() => t);

    await expect(
      timer.measure("ocrOwner", async () => {
        t += 7;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(timer.getMs("ocrOwner")).toBe(7);
  });
});

// ── buildFileMetric ──────────────────────────────────────────────────────────

describe("buildFileMetric", () => {
  it("assemble les métriques de page avec le chemin et le total fichier", () => {
    const pages = [
      {
        pageNum: 1,
        hasText: true,
        usedOcrForOwner: false,
        usedOcrForRotation: false,
        textExtractMs: 2,
        ownerParseMs: 1,
        textRotationDetectMs: 0,
        ocrRotationDetectMs: 0,
        ocrOwnerMs: 0,
        totalMs: 3,
      },
    ];

    const fileMetric = buildFileMetric("/tmp/a.pdf", pages, 3);

    expect(fileMetric).toEqual({
      filePath: "/tmp/a.pdf",
      pageCount: 1,
      totalMs: 3,
      pages,
    });
  });
});

// ── summarizeBatch ───────────────────────────────────────────────────────────

describe("summarizeBatch", () => {
  it("retourne des totaux nuls pour un batch vide", () => {
    const summary = summarizeBatch([]);
    expect(summary).toEqual({
      totalOcrMs: 0,
      totalNonOcrMs: 0,
      avgMsPerPage: 0,
      avgMsPerFile: 0,
      pagesUsingOcrOwner: 0,
      pagesUsingOcrRotation: 0,
      pageCount: 0,
    });
  });

  it("sépare le temps OCR du temps non-OCR sur une seule page", () => {
    const files: FileMetric[] = [
      {
        filePath: "/tmp/a.pdf",
        pageCount: 1,
        totalMs: 100,
        pages: [
          {
            pageNum: 1,
            hasText: false,
            usedOcrForOwner: true,
            usedOcrForRotation: true,
            textExtractMs: 5,
            ownerParseMs: 0,
            textRotationDetectMs: 0,
            ocrRotationDetectMs: 40,
            ocrOwnerMs: 50,
            totalMs: 95,
          },
        ],
      },
    ];

    const summary = summarizeBatch(files);

    expect(summary.totalOcrMs).toBe(90); // ocrRotationDetectMs + ocrOwnerMs
    expect(summary.totalNonOcrMs).toBe(5); // textExtractMs + ownerParseMs + textRotationDetectMs
    expect(summary.pagesUsingOcrOwner).toBe(1);
    expect(summary.pagesUsingOcrRotation).toBe(1);
    expect(summary.pageCount).toBe(1);
  });

  it("calcule la moyenne par page et par fichier sur plusieurs fichiers", () => {
    const files: FileMetric[] = [
      {
        filePath: "/tmp/a.pdf",
        pageCount: 2,
        totalMs: 100,
        pages: [
          {
            pageNum: 1,
            hasText: true,
            usedOcrForOwner: false,
            usedOcrForRotation: false,
            textExtractMs: 10,
            ownerParseMs: 0,
            textRotationDetectMs: 0,
            ocrRotationDetectMs: 0,
            ocrOwnerMs: 0,
            totalMs: 10,
          },
          {
            pageNum: 2,
            hasText: true,
            usedOcrForOwner: false,
            usedOcrForRotation: false,
            textExtractMs: 30,
            ownerParseMs: 0,
            textRotationDetectMs: 0,
            ocrRotationDetectMs: 0,
            ocrOwnerMs: 0,
            totalMs: 30,
          },
        ],
      },
      {
        filePath: "/tmp/b.pdf",
        pageCount: 1,
        totalMs: 60,
        pages: [
          {
            pageNum: 1,
            hasText: true,
            usedOcrForOwner: false,
            usedOcrForRotation: false,
            textExtractMs: 60,
            ownerParseMs: 0,
            textRotationDetectMs: 0,
            ocrRotationDetectMs: 0,
            ocrOwnerMs: 0,
            totalMs: 60,
          },
        ],
      },
    ];

    const summary = summarizeBatch(files);

    expect(summary.avgMsPerFile).toBe(80); // (100 + 60) / 2
    expect(summary.avgMsPerPage).toBeCloseTo(100 / 3); // (10+30+60) / 3 pages
    expect(summary.pageCount).toBe(3);
  });
});

// ── saveMetrics ──────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveMetrics", () => {
  it("crée le dossier metrics puis écrit un fichier JSON sous tempDir/metrics", async () => {
    const batch = {
      label: "baseline",
      startedAt: "2026-06-21T10:00:00.000Z",
      finishedAt: "2026-06-21T10:00:01.000Z",
      totalMs: 1000,
      fileCount: 0,
      files: [] as FileMetric[],
      summary: summarizeBatch([]),
    };

    const path = await saveMetrics(batch, "/tmp/app-temp");

    expect(mkdir).toHaveBeenCalledWith("/tmp/app-temp/metrics", { recursive: true });
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = vi.mocked(writeTextFile).mock.calls[0];
    expect(writtenPath).toBe(path);
    expect(writtenPath).toContain("/tmp/app-temp/metrics/baseline-");
    expect(JSON.parse(writtenContent as string)).toEqual(batch);
  });
});
