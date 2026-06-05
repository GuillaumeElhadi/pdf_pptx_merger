# OCR Owner Detection Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Tesseract.js OCR fallback to `extractOwners()` so owner detection works on vector-rendered PDFs (Windows "Print to PDF") that return 0 text items from pdfjs.

**Architecture:** `ocrExtractor.ts` manages a singleton Tesseract worker (French language, lazy init). `ownerExtractor.ts` is refactored to extract `matchOwner(string[])` and gains a per-page fallback: if `getTextContent()` returns no items, render the page top-35% to canvas via pdfjs, run OCR, try to match; if no match, OCR the full page. Both paths feed the same `matchOwner()` logic.

**Tech Stack:** tesseract.js v5, pdfjs-dist (already present), OffscreenCanvas (already used in pdfRenderer.ts), Vitest + vi.mock for tests.

---

## Files

| File | Change |
|---|---|
| `src/services/ocrExtractor.ts` | **Create** — Tesseract worker singleton + `ocrPage()` |
| `src/services/ownerExtractor.ts` | Refactor `parseOwner` → `matchOwner`, add OCR fallback, remove debug logs |
| `src/services/ownerExtractor.test.ts` | Mock `ocrExtractor`, add OCR fallback tests |
| `public/tessdata/fra.traineddata` | **Download** — French OCR model, bundled with app |
| `package.json` | Add `tesseract.js` dependency |

---

## Task 1: Install Tesseract.js and download French language data

**Files:**
- Modify: `package.json`
- Create: `public/tessdata/fra.traineddata`

- [ ] **Step 1: Install tesseract.js**

```bash
npm install tesseract.js
```

Expected: package added to `dependencies` in `package.json`.

- [ ] **Step 2: Create the tessdata directory and download `fra.traineddata`**

```bash
mkdir -p public/tessdata
curl -L "https://github.com/tesseract-ocr/tessdata_fast/raw/main/fra.traineddata" \
  -o "public/tessdata/fra.traineddata"
```

Expected: `public/tessdata/fra.traineddata` (~4MB) is present.

```bash
ls -lh public/tessdata/fra.traineddata
```

Expected output: file between 3MB and 5MB.

- [ ] **Step 3: Type-check to confirm tesseract.js types resolve**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json public/tessdata/fra.traineddata
git commit -m "feat: add tesseract.js and French language data for OCR"
```

---

## Task 2: Create `src/services/ocrExtractor.ts`

**Files:**
- Create: `src/services/ocrExtractor.ts`

This module owns the Tesseract worker lifecycle and converts a pdfjs page to text via OCR. It is not directly unit-tested — it is mocked in ownerExtractor tests (Task 4) and validated manually with the fixture PDF.

- [ ] **Step 1: Create `src/services/ocrExtractor.ts`**

```ts
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { createWorker, type Worker } from "tesseract.js";

let workerInstance: Worker | null = null;

async function ensureWorker(): Promise<Worker> {
  if (!workerInstance) {
    workerInstance = await createWorker("fra", 1, {
      langPath: `${window.location.origin}/tessdata`,
    });
  }
  return workerInstance;
}

/**
 * Renders a pdfjs page to canvas and returns the OCR text.
 *
 * "crop"  — top 35% of the page only (~0.5s). Use first: the owner label
 *           always appears in the top third of the page in known documents.
 * "full"  — entire page (~2-3s). Fallback when crop finds no owner.
 */
export async function ocrPage(page: PDFPageProxy, strategy: "crop" | "full"): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5 });
  const width = Math.floor(viewport.width);
  const fullHeight = Math.floor(viewport.height);
  const height = strategy === "crop" ? Math.floor(fullHeight * 0.35) : fullHeight;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const worker = await ensureWorker();
  const {
    data: { text },
  } = await worker.recognize(blob);
  return text;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If the `PDFPageProxy` import path causes issues, replace with:
```ts
type PDFPageProxy = Awaited<ReturnType<import("pdfjs-dist").PDFDocumentProxy["getPage"]>>;
```

- [ ] **Step 3: Commit**

```bash
git add src/services/ocrExtractor.ts
git commit -m "feat: add ocrExtractor with Tesseract worker singleton"
```

---

## Task 3: Extract `matchOwner()` from `parseOwner()` in `ownerExtractor.ts`

This is a pure refactoring. All existing tests must continue to pass — no new behavior is added yet.

**Files:**
- Modify: `src/services/ownerExtractor.ts`

- [ ] **Step 1: Run existing tests to establish baseline**

```bash
npx vitest run src/services/ownerExtractor.test.ts
```

Expected: PASS (18 tests). Note the count — it must stay the same after the refactor.

- [ ] **Step 2: Refactor `parseOwner` in `src/services/ownerExtractor.ts`**

Replace the existing `parseOwner` function (lines 52–86) with two functions:

```ts
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
  return null;
}

/** Returns the first OwnerInfo found in the given pdfjs Line sequence, or null. */
function parseOwner(lines: Line[]): OwnerInfo | null {
  return matchOwner(lines.map((l) => l.text));
}
```

- [ ] **Step 3: Run tests to confirm refactoring didn't break anything**

```bash
npx vitest run src/services/ownerExtractor.test.ts
```

Expected: PASS (18 tests — same count as Step 1).

- [ ] **Step 4: Commit**

```bash
git add src/services/ownerExtractor.ts
git commit -m "refactor: extract matchOwner(string[]) from parseOwner for OCR reuse"
```

---

## Task 4: Add OCR fallback in `ownerExtractor.ts` and update tests

**Files:**
- Modify: `src/services/ownerExtractor.ts`
- Modify: `src/services/ownerExtractor.test.ts`

- [ ] **Step 1: Add mock for `ocrExtractor` and import in `ownerExtractor.test.ts`**

At the top of `src/services/ownerExtractor.test.ts`, after the existing `vi.mock("pdfjs-dist", ...)` block, add:

```ts
vi.mock("./ocrExtractor", () => ({
  ocrPage: vi.fn().mockResolvedValue(""),
}));
```

Then add this import after the `import * as pdfjsLib from "pdfjs-dist"` line:

```ts
import { ocrPage } from "./ocrExtractor";
```

- [ ] **Step 2: Update `mockDocument` to return a page object that `ocrPage` can receive**

The current `mockDocument` returns pages with only `getTextContent`. For OCR tests, the page also needs `getViewport` and `render` (though these are mocked at the `ocrPage` level, pdfjs's `getPage` just needs to return something). Update the `mockPages` builder:

```ts
function mockDocument(
  pages: { width: number; height: number; items: ReturnType<typeof textItem>[] }[]
) {
  const mockPages = pages.map((p) => ({
    getTextContent: vi.fn(() => Promise.resolve({ items: p.items })),
    getViewport: vi.fn(() => ({ width: p.width, height: p.height })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  }));

  vi.mocked(pdfjsLib.getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: vi.fn((n: number) => Promise.resolve(mockPages[n - 1])),
      destroy: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as ReturnType<typeof pdfjsLib.getDocument>);
}
```

- [ ] **Step 3: Write the four failing OCR fallback tests**

Add a new `describe` block at the end of `src/services/ownerExtractor.test.ts`:

```ts
describe("extractOwners — fallback OCR (page sans texte)", () => {
  it("appelle ocrPage('crop') quand une page n'a aucun item texte", async () => {
    vi.mocked(ocrPage).mockResolvedValue(
      "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR"
    );
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPage).toHaveBeenCalledWith(expect.anything(), "crop");
    expect(result.owners).toEqual([{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }]);
  });

  it("n'appelle pas ocrPage('full') si le crop a trouvé un propriétaire", async () => {
    vi.mocked(ocrPage).mockResolvedValue(
      "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR"
    );
    mockDocument([{ width: 595, height: 842, items: [] }]);
    await extractOwners("/doc.pdf");
    expect(ocrPage).toHaveBeenCalledTimes(1);
    expect(ocrPage).toHaveBeenCalledWith(expect.anything(), "crop");
  });

  it("escalade vers ocrPage('full') si le crop ne trouve pas de propriétaire", async () => {
    vi.mocked(ocrPage)
      .mockResolvedValueOnce("Texte sans propriétaire dans le bandeau") // crop
      .mockResolvedValueOnce("Copropriétaire 0000042\nSARL DUPONT IMMOBILIER"); // full
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPage).toHaveBeenNthCalledWith(1, expect.anything(), "crop");
    expect(ocrPage).toHaveBeenNthCalledWith(2, expect.anything(), "full");
    expect(result.owners).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
  });

  it("n'appelle pas ocrPage quand la page a du texte", async () => {
    mockDocument([{
      width: 595,
      height: 842,
      items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
    }]);
    await extractOwners("/doc.pdf");
    expect(ocrPage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the new tests to confirm they fail**

```bash
npx vitest run src/services/ownerExtractor.test.ts
```

Expected: 4 new tests FAIL (ocrPage is not yet imported/called in ownerExtractor.ts), 18 existing tests PASS.

- [ ] **Step 5: Implement the OCR fallback in `src/services/ownerExtractor.ts`**

**5a. Add the import at the top of the file (after existing imports):**

```ts
import { ocrPage } from "./ocrExtractor";
```

**5b. Replace the entire body of `extractOwners` after the `pdf` is resolved — from the `try {` block through the closing `} finally {` — with:**

```ts
  try {
    const found = new Map<string, OwnerInfo>();
    const pageOwners = new Map<number, OwnerInfo>();

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const hasText = content.items.some(
        (i) => isPdfTextItem(i) && i.str.trim().length > 0
      );

      let owner: OwnerInfo | null = null;

      if (hasText) {
        owner = parseOwner(buildLines(content.items));
      } else {
        const cropText = await ocrPage(page, "crop");
        owner = matchOwner(cropText.split("\n").map((l) => l.trim()).filter(Boolean));
        if (!owner) {
          const fullText = await ocrPage(page, "full");
          owner = matchOwner(fullText.split("\n").map((l) => l.trim()).filter(Boolean));
        }
      }

      if (owner) {
        if (!found.has(owner.code)) found.set(owner.code, owner);
        pageOwners.set(pageNum, found.get(owner.code)!);
      }
    }

    return { owners: Array.from(found.values()), pageOwners };
  } finally {
    await pdf.destroy();
  }
```

Note: this replaces everything inside the `try { ... } finally { await pdf.destroy(); }` block, including the debug diagnostic code (the `console.info` for first-page lines and the `console.warn` for suspect lines) — both are removed as part of this step since OCR now handles detection.

The complete `extractOwners` function after this change:

```ts
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

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const hasText = content.items.some(
        (i) => isPdfTextItem(i) && i.str.trim().length > 0
      );

      let owner: OwnerInfo | null = null;

      if (hasText) {
        owner = parseOwner(buildLines(content.items));
      } else {
        const cropText = await ocrPage(page, "crop");
        owner = matchOwner(cropText.split("\n").map((l) => l.trim()).filter(Boolean));
        if (!owner) {
          const fullText = await ocrPage(page, "full");
          owner = matchOwner(fullText.split("\n").map((l) => l.trim()).filter(Boolean));
        }
      }

      if (owner) {
        if (!found.has(owner.code)) found.set(owner.code, owner);
        pageOwners.set(pageNum, found.get(owner.code)!);
      }
    }

    return { owners: Array.from(found.values()), pageOwners };
  } finally {
    await pdf.destroy();
  }
}
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run src/services/ownerExtractor.test.ts
```

Expected: PASS (22 tests — 18 existing + 4 new).

- [ ] **Step 7: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass (pre-existing `useTheme.test.ts` failures are unrelated — ignore them if count matches before this change).

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/services/ownerExtractor.ts src/services/ownerExtractor.test.ts
git commit -m "feat: add OCR fallback for vector-rendered PDFs (tesseract.js, fra, crop→full strategy)"
```

---

## Manual Validation

After all tasks are committed, test with the real fixture:

1. Run `npm run tauri dev`
2. Open devtools (right-click → Inspect → Console)
3. Add `src/test/fixtures/10189 - PRREPC - ANNEXES DETAILLEES  - CC.pdf`
4. Observe console: Tesseract worker initializes once, then OCR runs per page
5. After extraction completes, status bar should show "1 PDF ajouté — N propriétaires détectés."
6. The OwnerBanner should list the detected owners

Expected timing: ~3-5s Tesseract init + ~0.5s/page (crop) or ~2-3s/page (full) for pages with owners.
