# OCR Owner Detection Fallback — Design Spec

**Date:** 2026-06-05
**Branch:** fix/owner-detection
**Status:** Approved

## Problem

PDFs generated via Windows "Print to PDF" render text as vector paths (bezier curves), not as PDF text objects. `pdfjsLib.getTextContent()` returns 0 items for every page of these documents. The existing `parseOwner()` logic never gets any input and always returns 0 owners.

Confirmed with `pdftotext` (poppler) and pdfjs operator inspection: the PDFs contain 2817 save/restore operations but zero font definitions or text operators. This is a property of the Windows GDI → PDF pipeline, not a bug in the extraction code.

## Goal

Add an OCR fallback using Tesseract.js so `extractOwners()` correctly identifies owners in vector-rendered PDFs, while preserving the fast text-extraction path for regular text-based PDFs.

## Architecture

### Files

| File | Change |
|---|---|
| `src/services/ocrExtractor.ts` | **New** — Tesseract worker singleton + `ocrPage()` |
| `src/services/ownerExtractor.ts` | Add per-page OCR fallback, extract `matchOwner()` from `parseOwner()` |
| `public/tessdata/fra.traineddata` | **New** — French OCR model (~4MB), bundled with app |
| `package.json` | Add `tesseract.js` dependency |

### `src/services/ocrExtractor.ts`

Manages the Tesseract worker as a module-level singleton. Exposes one public function:

```ts
export async function ocrPage(
  page: PDFPageProxy,
  strategy: "crop" | "full"
): Promise<string>
```

**Worker lifecycle:**
- Initialized lazily on first call via `ensureWorker()`
- Reused across all PDFs and pages — amortizes the 3-5s startup cost
- Language: `fra` (French), loaded from `/tessdata/fra.traineddata`
- Never explicitly terminated (app lifecycle handles cleanup)

```ts
let worker: Tesseract.Worker | null = null;

async function ensureWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await createWorker("fra", 1, { langPath: "/tessdata" });
  }
  return worker;
}
```

**Canvas rendering:**
- Scale: 1.5 (893×1263px for A4) — good OCR accuracy without excessive memory
- `"crop"` strategy: `OffscreenCanvas` at full width × top 35% of height (893×442px for A4). The owner label appears in the top third of the page in all known documents. pdfjs clips content outside the canvas bounds, so the crop is free.
- `"full"` strategy: `OffscreenCanvas` at full page dimensions

**Error handling:** if `ensureWorker()` or OCR throws, the exception propagates to `ownerExtractor.ts` which catches it and sets `ownersError` on the item, continuing to the next PDF. Same behavior as a pdfjs timeout.

### `src/services/ownerExtractor.ts`

**Refactoring:** Extract `matchOwner(orderedLines: string[]): OwnerInfo | null` from `parseOwner()`. The new function operates on plain strings in top-to-bottom order. The existing `parseOwner(lines: Line[])` becomes a thin wrapper: `return matchOwner(lines.map(l => l.text))`.

**Per-page fallback logic:**

```
getTextContent() → items
│
├─ items.length > 0 ──→ existing path: buildLines() + matchOwner()
│
└─ items.length === 0 ──→ OCR fallback:
    1. ocrPage(page, "crop") → text (top 35%, ~0.5s)
       matchOwner(text.split('\n').filter(Boolean)) → owner found? → done
    2. If not found:
       ocrPage(page, "full") → text (full page, ~2-3s)
       matchOwner(text.split('\n').filter(Boolean)) → result
    3. If still not found → page is orphan (existing behavior)
```

### `public/tessdata/fra.traineddata`

Downloaded once from the Tesseract trained data repository. Placed in `public/tessdata/` so Vite serves it at `/tessdata/fra.traineddata` in dev and Tauri bundles it automatically in production. No internet connection required at runtime.

## Data Flow

```
addPdfs() → extractOwners(pdfPath)
              │
              ├─ getDocument() + timeout (existing)
              │
              └─ for each page:
                    getTextContent()
                    │
                    ├─ has text → buildLines() → matchOwner() → pageOwners
                    │
                    └─ no text → ocrPage("crop") → matchOwner()
                                 └─ no owner → ocrPage("full") → matchOwner()
                                              └─ no owner → orphan page
```

## Testing

`ocrExtractor.ts` is mocked in `ownerExtractor.test.ts` via `vi.mock('../services/ocrExtractor')`.

Two new test groups:

1. **OCR fallback triggered:** page with 0 text items calls `ocrPage("crop")`; if `matchOwner` succeeds, `ocrPage("full")` is NOT called.
2. **Crop → full escalation:** if `ocrPage("crop")` returns text without an owner match, `ocrPage("full")` is called next.

End-to-end validation is manual using `src/test/fixtures/10189 - PRREPC - ANNEXES DETAILLEES - CC.pdf`.

## Performance

- Text-based PDFs: unchanged (0 OCR calls)
- Vector PDFs:
  - Pages without an owner: ~0.5s (crop only, no match)
  - Pages with an owner in the top 35%: ~0.5s (crop succeeds)
  - Pages with an owner outside the top 35%: ~3s (crop + full)
- Tesseract worker startup: ~3-5s, paid once across all 42 PDFs

## Out of scope

- Tesseract worker explicit teardown on app exit
- Support for non-French PDFs (other language models)
- Caching OCR results across sessions
