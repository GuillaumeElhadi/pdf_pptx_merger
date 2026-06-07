# Auto-Rotation of Scanned PDF Pages — Design Spec

**Date:** 2026-06-06

## Context

Scanned PDFs often contain pages that were fed into the scanner sideways. These pages have no `/Rotate` metadata so pdfjs renders them as-is, Tesseract OCR fails to read the sideways text, owner detection produces empty results, and the final merged PDF has rotated pages that the reader must tilt their head to read.

Text-based PDF pages are out of scope: pdfjs already respects the `/Rotate` attribute when rendering, and pdf-lib preserves it when copying pages, so they appear correctly oriented in both the UI and output.

## Approach

Orientation voting for scanned pages (those without embedded text). Try rendering the canvas at 0°, 90°, 180°, 270° via the pdfjs viewport rotation parameter. For each, run a fast crop OCR pass and count alphanumeric characters. The first orientation that produces ≥ 15 alphanumeric characters wins. The winning rotation is stored as a per-page correction and applied to OCR, thumbnails, and the final merged PDF.

## Data Flow

```
User loads PDF
    ↓
extractOwners() iterates all pages
    ↓
Page has no embedded text → ocrPageWithAutoRotation(page, "crop")
    tries [0, 90, 180, 270] until alphanumeric count ≥ 15
    returns { text, rotationCorrection }
    ↓
If no owner in crop text → ocrPage(page, "full", rotationCorrection)
    reuses detected rotation for full-page OCR
    ↓
pageRotationCorrections Map populated for non-zero corrections
    ↓
ExtractionResult.pageRotationCorrections → stored in PdfItem
    ↓
┌─────────────────────────────────────────────────────┐
│  Thumbnail re-renders with baked-in rotation        │
│  (pdfRenderer cache key includes rotationCorrection) │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  generate(): page.setRotation(                      │
│    (existing + item.rotation + correction) % 360    │
│  ) applied for every page in output PDF             │
└─────────────────────────────────────────────────────┘
```

## Changes

### 1. `src/services/ocrExtractor.ts`

**`ocrPage`** — add `rotation: Rotation = 0` parameter:
- Pass it to `page.getViewport({ scale: 1.5, rotation })` (additive on top of the PDF's own `/Rotate`)
- No other changes

**New `ocrPageWithAutoRotation(page, strategy)`**:
```typescript
export async function ocrPageWithAutoRotation(
  page: PDFPageProxy,
  strategy: "crop" | "full"
): Promise<{ text: string; rotationCorrection: Rotation }> {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const text = await ocrPage(page, "crop", rotation);
    if (countAlphanumeric(text) >= 15) {
      const finalText =
        strategy === "crop" ? text : await ocrPage(page, "full", rotation);
      return { text: finalText, rotationCorrection: rotation };
    }
  }
  return { text: await ocrPage(page, "full", 0), rotationCorrection: 0 };
}

function countAlphanumeric(text: string): number {
  return (text.match(/[a-zA-ZÀ-ÿ0-9]/g) ?? []).length;
}
```

Performance: correctly-oriented pages pass on the first attempt (1 OCR pass). Sideways pages add 1–3 extra crop passes (~0.5 s each).

### 2. `src/services/ownerExtractor.ts`

`ExtractionResult` gains:
```typescript
pageRotationCorrections: Map<number, Rotation>; // 1-based page → correction; absent entries mean 0
```

`extractOwners()` — scanned-page block changes from two sequential `ocrPage()` calls to:
```typescript
const { text: cropText, rotationCorrection } = await ocrPageWithAutoRotation(page, "crop");
owner = matchOwner(cropText.split("\n").map((l) => l.trim()).filter(Boolean));
if (!owner) {
  const fullText = await ocrPage(page, "full", rotationCorrection);
  owner = matchOwner(fullText.split("\n").map((l) => l.trim()).filter(Boolean));
}
if (rotationCorrection !== 0) pageRotationCorrections.set(pageNum, rotationCorrection);
```

Return value updated: `return { owners: ..., pageOwners: ..., pageRotationCorrections };`

### 3. `src/types/index.ts`

`PdfItem` gains:
```typescript
pageRotationCorrections?: Map<number, Rotation>;
```

### 4. `src/store/useMergeStore.ts`

**After extraction succeeds:** add `pageRotationCorrections: result.pageRotationCorrections` to the store update alongside `owners` and `pageOwners`.

**In `generate()`:** Three places copy pages via `pages.forEach`. Each needs the 1-based source page number (`pageNum`) to look up the correction. The pattern is the same in all three:

```typescript
// Before: copyPages(doc, someIndices) → pages.forEach(p => ...)
// After:  track the index so pageNum = someIndices[i] + 1

const indices = doc.getPageIndices(); // or includedIndices in the filtered path
const pages = await merged.copyPages(doc, indices);
pages.forEach((p: PDFPage, i: number) => {
  const pageNum = indices[i] + 1; // 1-based
  const correction = item.pageRotationCorrections?.get(pageNum) ?? 0;
  if (item.rotation !== 0 || correction !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation + correction) % 360));
  }
  merged.addPage(p);
});
```

The three call-sites are: (a) single-output `pdf` branch, (b) multi-owner "no owner detected → all pages" branch, (c) multi-owner "owner matches → filtered pages" branch. All follow the same pattern.

### 5. `src/services/pdfRenderer.ts`

`renderPage` gains `rotationCorrection: Rotation = 0`:
- Cache key: `${filePath}#${pageIndex}#${rotationCorrection}`
- Viewport: `page.getViewport({ scale, rotation: rotationCorrection })`

### 6. `src/hooks/useThumbnail.ts`

Add `rotationCorrection: Rotation = 0` parameter → pass to `renderPage` → add to `useEffect` dependency array.

### 7. `src/components/MergeList/ZoomThumb.tsx`

Add `rotationCorrection?: Rotation` prop → pass to `useThumbnail`.

### 8. `src/components/MergeList/PdfItemRow.tsx`

Pass `item.pageRotationCorrections?.get(1) ?? 0` as `rotationCorrection` to `ZoomThumb`.

## Testing

**Unit tests (`src/services/ocrExtractor.test.ts` — new file or added tests):**
- `ocrPageWithAutoRotation`: mock `ocrPage` to return empty string for 0°/90°, meaningful text for 180° → assert `rotationCorrection = 180` and correct text returned
- `ocrPageWithAutoRotation`: mock `ocrPage` to return ≥ 15 chars at 0° → assert only one `ocrPage` call made (early exit)
- `ocrPageWithAutoRotation`: mock all rotations returning < 15 chars → assert fallback full-page OCR at 0° is called

**Integration tests (`src/services/ownerExtractor.test.ts`):**
- Scanned page (no text items) with mock OCR returning empty at 0° and owner text at 90° → assert owner detected + `pageRotationCorrections.get(pageNum) === 90`
- Existing tests: update mock signature for `ocrPage` to accept the new `rotation` parameter (no behavioural change expected)

## Manual Verification

1. Load a PDF where some pages were scanned sideways
2. Thumbnails initially show rotated page, then update to correctly-oriented view once extraction completes
3. Owner banner appears with detected owners
4. Click Generate → output PDF has all pages reading in the correct direction
5. Load a standard correctly-oriented PDF → no visible change, no slowdown (first OCR pass passes threshold)
