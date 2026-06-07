# Auto-Rotation of Scanned PDF Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect and correct the reading orientation of scanned PDF pages — improving OCR accuracy during owner extraction and ensuring the final merged PDF has all pages correctly oriented.

**Architecture:** Three independent layers: (1) `ocrExtractor.ts` gains a `rotation` parameter and a new `ocrPageWithAutoRotation` function that tries four canvas rotations and picks the one yielding the most alphanumeric text; (2) `ownerExtractor.ts` and `useMergeStore.ts` propagate per-page rotation corrections through extraction → store → generate; (3) `pdfRenderer.ts` bakes the correction into cached thumbnails so the UI updates automatically once extraction finishes.

**Tech Stack:** TypeScript, pdfjs-dist (viewport rotation), Tesseract.js (OCR), pdf-lib (output rotation via `setRotation`), React + Zustand, Vitest

---

## Files

| Action | File | What changes |
|--------|------|--------------|
| Modify | `src/services/ocrExtractor.ts` | Add `rotation` param to `ocrPage`; add `ocrPageWithAutoRotation` |
| Create | `src/services/ocrExtractor.test.ts` | Tests for rotation param + voting logic |
| Modify | `src/services/ownerExtractor.ts` | Use `ocrPageWithAutoRotation`; add `pageRotationCorrections` to `ExtractionResult` |
| Modify | `src/services/ownerExtractor.test.ts` | Update OCR mock; add rotation correction tests |
| Modify | `src/types/index.ts` | Add `pageRotationCorrections?` to `PdfItem` |
| Modify | `src/store/useMergeStore.ts` | Store corrections after extraction; apply in generate (3 call-sites) |
| Modify | `src/store/useMergeStore.generate.test.ts` | Add per-page rotation correction tests |
| Modify | `src/services/pdfRenderer.ts` | Add `rotationCorrection` param, update cache key and viewport |
| Modify | `src/services/pdfRenderer.test.ts` | Add rotation cache isolation + viewport tests |
| Modify | `src/hooks/useThumbnail.ts` | Thread `rotationCorrection` through to `renderPage` |
| Modify | `src/components/MergeList/ZoomThumb.tsx` | Accept `rotationCorrection` prop |
| Modify | `src/components/MergeList/PdfItemRow.tsx` | Pass page-1 correction to `ZoomThumb` |

---

## Task 1: Add rotation support to `ocrPage` + `ocrPageWithAutoRotation`

**Files:**
- Create: `src/services/ocrExtractor.test.ts`
- Modify: `src/services/ocrExtractor.ts`

### Background

`ocrPage` currently calls `page.getViewport({ scale: 1.5 })`. After this task it will accept a `rotation: Rotation = 0` parameter and pass it to the viewport. A new exported function `ocrPageWithAutoRotation` tries rotations `[0, 90, 180, 270]` using "crop" mode, counts alphanumeric characters per attempt, and returns the first rotation that yields ≥ 15 chars (or falls back to full OCR at 0° if none does).

**Why 15 chars?** A single French word like "Copropriétaire" has 14 chars — 15 ensures at least one meaningful word is recognized, which is enough to confidently identify orientation.

### Tesseract singleton in tests

`ocrExtractor.ts` holds a module-level `workerInstance`. Once created in the first test, it is reused by all subsequent tests in the file. The shared `mockRecognize` vi.fn() (defined with the `mock` prefix so Vitest hoists it correctly) is what the mock worker's `recognize` method always points to. Call `mockRecognize.mockReset()` + `mockRecognize.mockResolvedValue({ data: { text: "" } })` in `beforeEach` to ensure a clean state.

- [ ] **Step 1: Create the test file with failing tests**

Create `src/services/ocrExtractor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

// mockRecognize: starts with "mock" so Vitest hoists it into the vi.mock factory scope
const mockRecognize = vi.fn();

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn().mockResolvedValue({ recognize: mockRecognize }),
}));

function makePage() {
  return {
    getViewport: vi.fn().mockImplementation(({ scale = 1 } = {}) => ({
      width: 200 * scale,
      height: 300 * scale,
    })),
    render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
  } as unknown as PDFPageProxy;
}

beforeEach(() => {
  // jsdom canvas.getContext("2d") returns null — override so ocrPage doesn't throw
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
  // Reset one-time mock queues AND set a safe default
  mockRecognize.mockReset();
  mockRecognize.mockResolvedValue({ data: { text: "" } });
});

// ── ocrPage ───────────────────────────────────────────────────────────────────

describe("ocrPage — rotation parameter", () => {
  it("transmet rotation=90 au viewport pdfjs", async () => {
    const page = makePage();
    await ocrPage(page, "crop", 90);
    expect(page.getViewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 }));
  });

  it("utilise rotation=0 si non spécifiée", async () => {
    const page = makePage();
    await ocrPage(page, "crop");
    expect(page.getViewport).toHaveBeenCalledWith(expect.objectContaining({ rotation: 0 }));
  });
});

// ── ocrPageWithAutoRotation ───────────────────────────────────────────────────

describe("ocrPageWithAutoRotation — sélection de rotation", () => {
  it("retourne rotationCorrection=0 si rotation=0 donne ≥ 15 caractères alphanumériques", async () => {
    mockRecognize.mockResolvedValue({
      data: { text: "Bonjour monde test programme abc" }, // 28 alphanum chars
    });
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page, "crop");
    expect(result.rotationCorrection).toBe(0);
    expect(result.text).toBe("Bonjour monde test programme abc");
    // Only one getViewport call: rotation=0 succeeded on first try
    expect(page.getViewport).toHaveBeenCalledTimes(1);
  });

  it("retourne rotationCorrection=90 si rotation=0 échoue mais rotation=90 réussit", async () => {
    mockRecognize
      .mockResolvedValueOnce({ data: { text: "" } }) // rotation=0 crop: no text
      .mockResolvedValueOnce({ data: { text: "Texte lisible en français programme" } }); // rotation=90 crop: good
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page, "crop");
    expect(result.rotationCorrection).toBe(90);
    expect(result.text).toBe("Texte lisible en français programme");
  });

  it("tente full OCR à 0° si aucune rotation de crop ne donne de texte", async () => {
    // 4 crop attempts + 1 full attempt
    mockRecognize
      .mockResolvedValueOnce({ data: { text: "" } }) // 0° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 90° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 180° crop
      .mockResolvedValueOnce({ data: { text: "" } }) // 270° crop
      .mockResolvedValueOnce({ data: { text: "Texte complet trouvé en pleine page" } }); // full at 0°
    const page = makePage();
    const result = await ocrPageWithAutoRotation(page, "crop");
    expect(result.rotationCorrection).toBe(0);
    expect(mockRecognize).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/ocrExtractor.test.ts
```

Expected: tests fail because `ocrPageWithAutoRotation` is not exported and `ocrPage` doesn't accept a `rotation` param.

- [ ] **Step 3: Implement the changes in `ocrExtractor.ts`**

Add `import type { Rotation } from "../types";` at the top.

Change the `ocrPage` signature and viewport call:

```typescript
export async function ocrPage(
  page: PDFPageProxy,
  strategy: "crop" | "full",
  rotation: Rotation = 0
): Promise<string> {
  const viewport = page.getViewport({ scale: 1.5, rotation });
  // rest of function unchanged
```

Add `countAlphanumeric` helper and `ocrPageWithAutoRotation` after `ocrPage`:

```typescript
function countAlphanumeric(text: string): number {
  return (text.match(/[a-zA-ZÀ-ÿ0-9]/g) ?? []).length;
}

/**
 * Tries canvas rotations 0°→90°→180°→270° using crop OCR.
 * Returns the first rotation yielding ≥ 15 alphanumeric chars.
 * Falls back to full-page OCR at 0° if no crop attempt succeeds.
 */
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
```

- [ ] **Step 4: Run tests — all must pass**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/ocrExtractor.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/ocrExtractor.ts src/services/ocrExtractor.test.ts
git commit -m "$(cat <<'EOF'
feat: add rotation support to ocrPage and ocrPageWithAutoRotation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update `ownerExtractor.ts` to use auto-rotation

**Files:**
- Modify: `src/services/ownerExtractor.ts`
- Modify: `src/services/ownerExtractor.test.ts`

### What changes

`ExtractionResult` gains a `pageRotationCorrections: Map<number, Rotation>` field (1-based page → degrees; only pages where correction ≠ 0 are stored).

In `extractOwners`, the scanned-page OCR block replaces the two direct `ocrPage` calls:

```
Before:
  ocrPage(page, "crop")  → try matchOwner
  ocrPage(page, "full")  → try matchOwner

After:
  ocrPageWithAutoRotation(page, "crop") → get { text: cropText, rotationCorrection }
  matchOwner(cropText)
  if no owner: ocrPage(page, "full", rotationCorrection) → try matchOwner
  if rotationCorrection !== 0: pageRotationCorrections.set(pageNum, rotationCorrection)
```

The existing OCR tests in `ownerExtractor.test.ts` mock `./ocrExtractor` at module level. They need updating: the mock must now export `ocrPageWithAutoRotation` returning `{ text, rotationCorrection }`, and the three OCR tests need to assert on `ocrPageWithAutoRotation` instead of `ocrPage`.

- [ ] **Step 1: Write failing tests**

In `src/services/ownerExtractor.test.ts`:

**a) Update the top mock** (around line 14) — add `ocrPageWithAutoRotation`:

```typescript
vi.mock("./ocrExtractor", () => ({
  ocrPage: vi.fn().mockResolvedValue(""),
  ocrPageWithAutoRotation: vi.fn().mockResolvedValue({ text: "", rotationCorrection: 0 }),
}));
```

**b) Update the import** (around line 21) — add `ocrPageWithAutoRotation`:

```typescript
import { ocrPage } from "./ocrExtractor";
import { ocrPageWithAutoRotation } from "./ocrExtractor";
```

**c) Replace the three existing tests in `describe("extractOwners — fallback OCR (page sans texte)", ...)` with:**

```typescript
describe("extractOwners — fallback OCR (page sans texte)", () => {
  it("appelle ocrPageWithAutoRotation('crop') quand une page n'a aucun item texte", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), "crop");
    expect(result.owners).toEqual([{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }]);
  });

  it("n'appelle pas ocrPage('full') si ocrPageWithAutoRotation a trouvé un propriétaire", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledTimes(1);
    expect(ocrPage).not.toHaveBeenCalled();
  });

  it("escalade vers ocrPage('full', rotationCorrection) si le crop ne trouve pas de propriétaire", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Texte sans propriétaire dans le bandeau",
      rotationCorrection: 90,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce("Copropriétaire 0000042\nSARL DUPONT IMMOBILIER");
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenNthCalledWith(1, expect.anything(), "crop");
    expect(ocrPage).toHaveBeenNthCalledWith(1, expect.anything(), "full", 90);
    expect(result.owners).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
  });

  it("n'appelle pas ocrPage ni ocrPageWithAutoRotation quand la page a du texte", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
    ]);
    await extractOwners("/doc.pdf");
    expect(ocrPage).not.toHaveBeenCalled();
    expect(ocrPageWithAutoRotation).not.toHaveBeenCalled();
  });
});
```

**d) Add a new `describe` block for rotation correction storage (append after the last existing describe block):**

```typescript
describe("extractOwners — pageRotationCorrections", () => {
  it("stocke la correction non-zéro dans pageRotationCorrections", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 90,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.get(1)).toBe(90);
  });

  it("n'enregistre pas une correction de 0° dans pageRotationCorrections", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.size).toBe(0);
  });

  it("pageRotationCorrections est un Map vide pour une page avec texte intégré", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections).toBeInstanceOf(Map);
    expect(result.pageRotationCorrections.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/ownerExtractor.test.ts
```

Expected: the updated OCR tests fail (wrong function called), new rotation tests fail (field doesn't exist).

- [ ] **Step 3: Implement changes in `ownerExtractor.ts`**

**a) Add imports** at the top:

```typescript
import { ocrPage, ocrPageWithAutoRotation } from "./ocrExtractor";
import type { Rotation } from "../types";
```

(Remove the existing `import { ocrPage } from "./ocrExtractor";` line.)

**b) Update `ExtractionResult`:**

```typescript
export interface ExtractionResult {
  /** Distinct owners found across all pages. */
  owners: OwnerInfo[];
  /** 1-based page number → owner. Pages absent from the map are orphans. */
  pageOwners: Map<number, OwnerInfo>;
  /** 1-based page → rotation correction (degrees CCW). Only non-zero entries stored. */
  pageRotationCorrections: Map<number, Rotation>;
}
```

**c) Inside `extractOwners`, right after `const pageOwners = new Map<number, OwnerInfo>();` add:**

```typescript
const pageRotationCorrections = new Map<number, Rotation>();
```

**d) Replace the scanned-page OCR block** (the `if (hasText) { ... } else { ... }` section) with:

```typescript
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
```

**e) Update the `return` statement** at the end of the `try` block:

```typescript
return { owners: Array.from(found.values()), pageOwners, pageRotationCorrections };
```

- [ ] **Step 4: Run tests — all must pass**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/ownerExtractor.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/ownerExtractor.ts src/services/ownerExtractor.test.ts
git commit -m "$(cat <<'EOF'
feat: use ocrPageWithAutoRotation in extractOwners, propagate pageRotationCorrections

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `pageRotationCorrections` to `PdfItem` and persist it in the store

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/store/useMergeStore.ts`

- [ ] **Step 1: Update `PdfItem` in `src/types/index.ts`**

Add the new optional field after `pageOwners`:

```typescript
export interface PdfItem {
  id: string;
  type: "pdf";
  pdfPath: string;
  rotation: Rotation;
  owners?: OwnerInfo[];
  ownersError?: string;
  /** 1-based page → owner. Pages absent from the map are orphans included in all split outputs. */
  pageOwners?: Map<number, OwnerInfo>;
  /** 1-based page → rotation correction (degrees CCW). Only pages needing non-zero correction. */
  pageRotationCorrections?: Map<number, Rotation>;
}
```

- [ ] **Step 2: Update the extraction success handler in `useMergeStore.ts`**

Find the line (around line 163):
```typescript
const { owners, pageOwners } = await extractOwners(item.pdfPath);
```
Change to:
```typescript
const { owners, pageOwners, pageRotationCorrections } = await extractOwners(item.pdfPath);
```

Find the store update line (around line 173):
```typescript
items: s.items.map((i) => (i.id === item.id ? { ...i, owners, pageOwners } : i)),
```
Change to:
```typescript
items: s.items.map((i) =>
  i.id === item.id ? { ...i, owners, pageOwners, pageRotationCorrections } : i
),
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/store/useMergeStore.ts
git commit -m "$(cat <<'EOF'
feat: add pageRotationCorrections to PdfItem, persist from extractOwners result

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply per-page rotation correction in `generate()`

**Files:**
- Modify: `src/store/useMergeStore.ts`
- Modify: `src/store/useMergeStore.generate.test.ts`

### What changes

Three `pages.forEach` call-sites in `generate()` currently apply `item.rotation` via:
```typescript
if (item.rotation !== 0) {
  p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
}
```

All three become:
```typescript
const correction = item.pageRotationCorrections?.get(pageNum) ?? 0;
if (item.rotation !== 0 || correction !== 0) {
  p.setRotation(degrees((p.getRotation().angle + item.rotation + correction) % 360));
}
```

Where `pageNum = indices[i] + 1` (derived from the indices array passed to `copyPages`).

The three call-sites are:
1. **Single-output PDF branch** — `copyPages(doc, doc.getPageIndices())`
2. **Multi-owner, "no owner detected" branch** — `copyPages(doc, doc.getPageIndices())`
3. **Multi-owner, "owner matches, filtered pages" branch** — `copyPages(doc, includedIndices)`

- [ ] **Step 1: Write failing test for the single-output path**

Append to `src/store/useMergeStore.generate.test.ts` inside the rotation describe block (around line 336, after the existing rotation tests):

```typescript
it("pageRotationCorrections page 1 = 90° → setRotation appelé avec 90 (correction seule, item.rotation=0)", async () => {
  const page = makePage(0);
  const mergedDoc = makeMergedDoc();
  mergedDoc.copyPages.mockResolvedValue([page]);
  vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
  vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
  vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

  const pdfItem: PdfItem = {
    ...makePdf("a", "/a.pdf"),
    rotation: 0,
    pageRotationCorrections: new Map([[1, 90 as const]]),
  };
  useMergeStore.setState({ items: [pdfItem] });
  await useMergeStore.getState().generate();

  // (page.angle 0 + item.rotation 0 + correction 90) % 360 = 90
  expect(page.setRotation).toHaveBeenCalledWith(90);
});

it("pageRotationCorrections page 1 = 90° + item.rotation = 90° → setRotation appelé avec 180", async () => {
  const page = makePage(0);
  const mergedDoc = makeMergedDoc();
  mergedDoc.copyPages.mockResolvedValue([page]);
  vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
  vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
  vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

  const pdfItem: PdfItem = {
    ...makePdf("a", "/a.pdf"),
    rotation: 90 as const,
    pageRotationCorrections: new Map([[1, 90 as const]]),
  };
  useMergeStore.setState({ items: [pdfItem] });
  await useMergeStore.getState().generate();

  // (0 + 90 + 90) % 360 = 180
  expect(page.setRotation).toHaveBeenCalledWith(180);
});

it("pageRotationCorrections absent → setRotation pas appelé si item.rotation=0", async () => {
  const page = makePage(0);
  const mergedDoc = makeMergedDoc();
  mergedDoc.copyPages.mockResolvedValue([page]);
  vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
  vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(1) as any);
  vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

  useMergeStore.setState({ items: [{ ...makePdf("a"), rotation: 0 }] });
  await useMergeStore.getState().generate();

  expect(page.setRotation).not.toHaveBeenCalled();
});

it("correction sur page 2 seulement (PDF 2 pages) → setRotation appelé une seule fois pour page 2", async () => {
  const [p1, p2] = [makePage(0), makePage(0)];
  const mergedDoc = makeMergedDoc();
  mergedDoc.copyPages.mockResolvedValue([p1, p2]);
  vi.mocked(PDFDocument.create).mockResolvedValue(mergedDoc as any);
  vi.mocked(PDFDocument.load).mockResolvedValue(makeSourceDoc(2) as any);
  vi.mocked(Bridge.pickSaveLocation).mockResolvedValue("/out/result.pdf");

  const pdfItem: PdfItem = {
    ...makePdf("a", "/a.pdf"),
    rotation: 0,
    pageRotationCorrections: new Map([[2, 270 as const]]), // only page 2 needs correction
  };
  useMergeStore.setState({ items: [pdfItem] });
  await useMergeStore.getState().generate();

  expect(p1.setRotation).not.toHaveBeenCalled();
  expect(p2.setRotation).toHaveBeenCalledWith(270);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/store/useMergeStore.generate.test.ts --reporter verbose 2>&1 | tail -30
```

Expected: the 4 new tests fail; existing tests pass.

- [ ] **Step 3: Implement the changes in `generate()` in `useMergeStore.ts`**

**Call-site 1 — single-output PDF branch** (around line 460, the `else` branch):

Find:
```typescript
const doc = await loadOrCacheDoc(item.pdfPath);
const pages = await merged.copyPages(doc, doc.getPageIndices());
pages.forEach((p: PDFPage) => {
  if (item.rotation !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
  }
  merged.addPage(p);
});
```

Replace with:
```typescript
const doc = await loadOrCacheDoc(item.pdfPath);
const indices = doc.getPageIndices();
const pages = await merged.copyPages(doc, indices);
pages.forEach((p: PDFPage, i: number) => {
  const pageNum = indices[i] + 1;
  const correction = item.pageRotationCorrections?.get(pageNum) ?? 0;
  if (item.rotation !== 0 || correction !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation + correction) % 360));
  }
  merged.addPage(p);
});
```

**Call-site 2 — multi-owner, "no owner detected → all pages" branch** (around line 396):

Find:
```typescript
const pages = await merged.copyPages(doc, doc.getPageIndices());
pages.forEach((p: PDFPage) => {
  if (item.rotation !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
  }
  merged.addPage(p);
});
```

Replace with:
```typescript
const allIndices = doc.getPageIndices();
const pages = await merged.copyPages(doc, allIndices);
pages.forEach((p: PDFPage, i: number) => {
  const pageNum = allIndices[i] + 1;
  const correction = item.pageRotationCorrections?.get(pageNum) ?? 0;
  if (item.rotation !== 0 || correction !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation + correction) % 360));
  }
  merged.addPage(p);
});
```

**Call-site 3 — multi-owner, "owner matches, filtered pages" branch** (around line 415):

Find:
```typescript
const pages = await merged.copyPages(doc, includedIndices);
pages.forEach((p: PDFPage) => {
  if (item.rotation !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation) % 360));
  }
  merged.addPage(p);
});
```

Replace with:
```typescript
const pages = await merged.copyPages(doc, includedIndices);
pages.forEach((p: PDFPage, i: number) => {
  const pageNum = includedIndices[i] + 1;
  const correction = item.pageRotationCorrections?.get(pageNum) ?? 0;
  if (item.rotation !== 0 || correction !== 0) {
    p.setRotation(degrees((p.getRotation().angle + item.rotation + correction) % 360));
  }
  merged.addPage(p);
});
```

- [ ] **Step 4: Run all generate tests — all must pass**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/store/useMergeStore.generate.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/useMergeStore.ts src/store/useMergeStore.generate.test.ts
git commit -m "$(cat <<'EOF'
feat: apply per-page rotation correction in generate() across all three copy-pages call-sites

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add rotation correction to `pdfRenderer.ts`

**Files:**
- Modify: `src/services/pdfRenderer.ts`
- Modify: `src/services/pdfRenderer.test.ts`

### What changes

`renderPage` gains a `rotationCorrection: Rotation = 0` parameter. The cache key becomes `${filePath}#${pageIndex}#${rotationCorrection}`. The viewport call passes the correction to pdfjs (additive on top of the page's own `/Rotate` attribute):
```typescript
const viewport = page.getViewport({ scale: 1, rotation: rotationCorrection });
```

When `rotationCorrection = 0` (the default), behaviour is identical to today.

The existing `pdfRenderer.test.ts` `makePdfPage` mock only destructures `scale` from the viewport options object — the new `rotation` field is silently ignored, so existing tests pass without modification.

- [ ] **Step 1: Write failing tests**

In `src/services/pdfRenderer.test.ts`, locate `describe("renderPage — cache", ...)` (or similar) and add new tests. If no such block exists, append this new describe block:

```typescript
describe("renderPage — rotationCorrection", () => {
  it("transmet rotationCorrection=90 au viewport pdfjs", async () => {
    const page = makePdfPage();
    setupPdfjs(page);
    await renderPage(freshPath(), 0, 160, 90);
    expect(page.getViewport).toHaveBeenCalledWith(
      expect.objectContaining({ rotation: 90 })
    );
  });

  it("deux appels même chemin/page mais rotationCorrection différente → deux renders distincts (cache isolé)", async () => {
    const path = freshPath();
    setupPdfjs(makePdfPage());
    await renderPage(path, 0, 160, 0);
    // Second call: same path + pageIndex but different rotation → must miss cache
    setupPdfjs(makePdfPage());
    await renderPage(path, 0, 160, 90);
    expect(pdfjsLib.getDocument).toHaveBeenCalledTimes(2);
  });

  it("même chemin/page/rotation → le cache retourne la même URL sans re-render", async () => {
    const path = freshPath();
    setupPdfjs(makePdfPage());
    const url1 = await renderPage(path, 0, 160, 180);
    const url2 = await renderPage(path, 0, 160, 180);
    expect(pdfjsLib.getDocument).toHaveBeenCalledTimes(1); // cached on second call
    expect(url1).toBe(url2);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/pdfRenderer.test.ts
```

Expected: the 3 new tests fail; all existing tests still pass.

- [ ] **Step 3: Implement changes in `pdfRenderer.ts`**

Add the `Rotation` import at the top:
```typescript
import type { Rotation } from "../types";
```

Update the function signature, cache key, and viewport calls:

```typescript
export async function renderPage(
  filePath: string,
  pageIndex: number = 0,
  width: number = 160,
  rotationCorrection: Rotation = 0
): Promise<string> {
  const cacheKey = `${filePath}#${pageIndex}#${rotationCorrection}`;
  const cached = renderedPageCache.get(cacheKey);
  if (cached) return cached;

  const url = convertFileSrc(filePath);
  const pdf = await pdfjsLib.getDocument(url).promise;

  try {
    const page = await pdf.getPage(pageIndex + 1);

    const viewport = page.getViewport({ scale: 1, rotation: rotationCorrection });
    const scale = width / viewport.width;
    const scaled = page.getViewport({ scale, rotation: rotationCorrection });

    const canvas = new OffscreenCanvas(Math.floor(scaled.width), Math.floor(scaled.height));
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: scaled,
    }).promise;

    const blob = await canvas.convertToBlob({ type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    renderedPageCache.set(cacheKey, objectUrl);
    return objectUrl;
  } finally {
    await pdf.destroy();
  }
}
```

- [ ] **Step 4: Run all pdfRenderer tests — all must pass**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run src/services/pdfRenderer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/pdfRenderer.ts src/services/pdfRenderer.test.ts
git commit -m "$(cat <<'EOF'
feat: add rotationCorrection param to renderPage, isolate cache entries by rotation

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Thread rotation correction through the UI

**Files:**
- Modify: `src/hooks/useThumbnail.ts`
- Modify: `src/components/MergeList/ZoomThumb.tsx`
- Modify: `src/components/MergeList/PdfItemRow.tsx`

No unit tests exist for these UI components; correctness is verified by type-check.

- [ ] **Step 1: Update `useThumbnail.ts`**

```typescript
import type { Rotation } from "../types";

export function useThumbnail(
  pdfPath: string | null,
  pageIndex: number = 0,
  width: number = 160,
  rotationCorrection: Rotation = 0
): ThumbnailState {
  const [state, setState] = useState<ThumbnailState>({
    url: null,
    loading: !!pdfPath,
  });

  useEffect(() => {
    if (!pdfPath) {
      setState({ url: null, loading: false });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true });

    renderPage(pdfPath, pageIndex, width, rotationCorrection)
      .then((url) => {
        if (!cancelled) setState({ url, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPath, pageIndex, width, rotationCorrection]);

  return state;
}
```

- [ ] **Step 2: Update `ZoomThumb.tsx`**

Add `rotationCorrection?: Rotation` to `Props` and pass it to `useThumbnail`:

```typescript
import type { Rotation } from "../../types";

interface Props {
  pdfPath: string | null;
  pageIndex: number;
  alt: string;
  rotation?: Rotation;
  rotationCorrection?: Rotation;
}

export function ZoomThumb({
  pdfPath,
  pageIndex,
  alt,
  rotation = 0,
  rotationCorrection = 0,
}: Props) {
  const { url } = useThumbnail(pdfPath, pageIndex, 600, rotationCorrection);
  // rest of component unchanged
```

- [ ] **Step 3: Update `PdfItemRow.tsx`**

Pass the first-page correction (page 1, 1-based) to `ZoomThumb`:

```typescript
<ZoomThumb
  pdfPath={item.pdfPath}
  pageIndex={0}
  alt={basename(item.pdfPath)}
  rotation={item.rotation}
  rotationCorrection={(item.pageRotationCorrections?.get(1) ?? 0) as Rotation}
/>
```

Note: `(item.pageRotationCorrections?.get(1) ?? 0) as Rotation` — the Map stores only `Rotation` values (0 | 90 | 180 | 270), so the cast is safe.

- [ ] **Step 4: Type-check the whole project**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/guillaume.elhadi/Developer/pdf_pptx_merger && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useThumbnail.ts src/components/MergeList/ZoomThumb.tsx src/components/MergeList/PdfItemRow.tsx
git commit -m "$(cat <<'EOF'
feat: thread rotationCorrection through useThumbnail → ZoomThumb → PdfItemRow

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

1. Run `npm run tauri dev`
2. Load a PDF that was scanned sideways (portrait dimensions but landscape content)
3. After a few seconds the thumbnail should update to show the page correctly oriented
4. The owner banner should appear if "Copropriétaire" text is present
5. Click Generate → the output PDF should open in a viewer with all pages reading correctly
6. Load a normally-oriented PDF → no visible change, no slowdown (first OCR crop attempt passes threshold at rotation=0)
