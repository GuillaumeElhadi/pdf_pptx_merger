# Owner Detection Fix & Progress Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the permanent extraction hang (23 PDFs overwhelm the pdf.js worker pool) by switching to sequential processing, and surface extraction progress in the StatusBar.

**Architecture:** Replace the `forEach(async ...)` fan-out in `addPdfs` with a sequential `for...of` loop that awaits each `extractOwners` call. Reuse the existing `progress: number | null` store field (already wired to the StatusBar progress track) and add a new `"extracting"` variant to `AppStatus` so the spinner appears during extraction.

**Tech Stack:** React, TypeScript, Zustand, Vitest + Testing Library

---

## Files

| File | Change |
|---|---|
| `src/types/index.ts` | Add `"extracting"` to `AppStatus` |
| `src/strings.ts` | Add `status.extractingOwners(done, total)` |
| `src/store/useMergeStore.ts` | Rewrite `addPdfs` extraction loop |
| `src/components/StatusBar.tsx` | Add `"extracting"` to spinner condition |
| `src/components/StatusBar.test.tsx` | Add tests for `"extracting"` state |
| `src/store/useMergeStore.test.ts` | Update + add `addPdfs` tests |

---

## Task 1: Add `"extracting"` to `AppStatus` and update StatusBar

### Files
- Modify: `src/types/index.ts`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/StatusBar.test.tsx`

- [ ] **Step 1: Add `"extracting"` to `AppStatus`**

Open `src/types/index.ts` and change line 35:

```ts
// before
export type AppStatus = "idle" | "converting" | "merging" | "error";

// after
export type AppStatus = "idle" | "converting" | "merging" | "extracting" | "error";
```

- [ ] **Step 2: Write the two failing StatusBar tests**

In `src/components/StatusBar.test.tsx`, add a new `describe` block after the `"état converting"` block:

```ts
describe("StatusBar — état extracting", () => {
  it("affiche le spinner et le message d'analyse", () => {
    useMergeStore.setState({
      status: "extracting",
      statusMessage: "Analyse des propriétaires… 1/5",
      progress: 0.2,
    });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("⏳")).toBeInTheDocument();
    expect(screen.getByText("Analyse des propriétaires… 1/5")).toBeInTheDocument();
  });

  it("affiche la barre de progression pendant l'analyse", () => {
    useMergeStore.setState({ status: "extracting", progress: 0.4, statusMessage: "" });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    expect(container.querySelector("[style*='40%']")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
npx vitest run src/components/StatusBar.test.tsx
```

Expected: the two new tests fail — spinner is not shown for `"extracting"`.

- [ ] **Step 4: Update the spinner condition in `StatusBar.tsx`**

In `src/components/StatusBar.tsx`, find this line (around line 38):

```tsx
{(status === "converting" || status === "merging") && (
```

Replace with:

```tsx
{(status === "converting" || status === "merging" || status === "extracting") && (
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
npx vitest run src/components/StatusBar.test.tsx
```

Expected: all StatusBar tests pass.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/components/StatusBar.tsx src/components/StatusBar.test.tsx
git commit -m "feat: add 'extracting' status — type, spinner, and tests"
```

---

## Task 2: Add extraction string and rewrite `addPdfs`

### Files
- Modify: `src/strings.ts`
- Modify: `src/store/useMergeStore.ts`
- Modify: `src/store/useMergeStore.test.ts`

- [ ] **Step 1: Update the failing and outdated `addPdfs` tests**

Open `src/store/useMergeStore.test.ts`. The existing `addPdfs` tests assume the old `forEach(async)` pattern: some tests use `await Promise.resolve(); await Promise.resolve()` to flush background microtasks. After the rewrite, `addPdfs` awaits all extractions before returning, so those flushes are no longer needed.

Make these targeted changes inside the `describe("useMergeStore — addPdfs", ...)` block:

**1a. Replace the "items apparaissent immédiatement" test and remove the now-unused `ExtractionResult` import.**

First, remove the import at line 4 of the test file (it is only used in the old test being replaced):

```ts
// Delete this line:
import type { ExtractionResult } from "../services/ownerExtractor";
```

Then, replace the old test (lines 234–253):
```ts
it("les items apparaissent immédiatement (owners undefined avant extraction)", async () => {
  let resolveExtraction!: (v: ExtractionResult) => void;
  vi.mocked(extractOwners).mockReturnValue(
    new Promise((r) => {
      resolveExtraction = r;
    })
  );
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  // Items are in the store, owners not yet set
  const { items } = useMergeStore.getState();
  expect(items).toHaveLength(1);
  expect((items[0] as PdfItem).owners).toBeUndefined();

  // Let extraction finish
  resolveExtraction({ owners: [], pageOwners: new Map() });
  await Promise.resolve();
});
```

Replace with:
```ts
it("les items sont dans le store dès que l'extraction commence", async () => {
  let itemCountWhenExtractionStarts = -1;
  vi.mocked(extractOwners).mockImplementation(async () => {
    itemCountWhenExtractionStarts = useMergeStore.getState().items.length;
    return { owners: [], pageOwners: new Map() };
  });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  expect(itemCountWhenExtractionStarts).toBe(1);
});
```

**1b. Update "peuple owners" test — remove the `Promise.resolve` flushes.**

Old (lines 255–267):
```ts
it("peuple owners une fois l'extraction terminée", async () => {
  const detected = [{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }];
  vi.mocked(extractOwners).mockResolvedValue({ owners: detected, pageOwners: new Map() });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  // Allow the background microtask to settle
  await Promise.resolve();
  await Promise.resolve();

  const { items } = useMergeStore.getState();
  expect((items[0] as PdfItem).owners).toEqual(detected);
});
```

Replace with:
```ts
it("peuple owners une fois l'extraction terminée", async () => {
  const detected = [{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }];
  vi.mocked(extractOwners).mockResolvedValue({ owners: detected, pageOwners: new Map() });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();

  const { items } = useMergeStore.getState();
  expect((items[0] as PdfItem).owners).toEqual(detected);
});
```

**1c. Update "peuple pageOwners" test — same removal.**

Old (lines 269–283):
```ts
it("peuple pageOwners une fois l'extraction terminée", async () => {
  const pageOwnersMap = new Map([[1, { code: "0000001", name: "OWNER A" }]]);
  vi.mocked(extractOwners).mockResolvedValue({
    owners: [{ code: "0000001", name: "OWNER A" }],
    pageOwners: pageOwnersMap,
  });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  await Promise.resolve();
  await Promise.resolve();

  const item = useMergeStore.getState().items[0] as PdfItem;
  expect(item.pageOwners).toEqual(pageOwnersMap);
});
```

Replace with:
```ts
it("peuple pageOwners une fois l'extraction terminée", async () => {
  const pageOwnersMap = new Map([[1, { code: "0000001", name: "OWNER A" }]]);
  vi.mocked(extractOwners).mockResolvedValue({
    owners: [{ code: "0000001", name: "OWNER A" }],
    pageOwners: pageOwnersMap,
  });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();

  const item = useMergeStore.getState().items[0] as PdfItem;
  expect(item.pageOwners).toEqual(pageOwnersMap);
});
```

**1d. Update "ownersError" test — same removal.**

Old (lines 285–297):
```ts
it("laisse owners undefined et peuple ownersError si extractOwners lève une erreur", async () => {
  vi.mocked(extractOwners).mockRejectedValue(new Error("échec extraction"));
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  await Promise.resolve();
  await Promise.resolve();

  const item = useMergeStore.getState().items[0] as PdfItem;
  expect(item.owners).toBeUndefined();
  expect(item.ownersError).toMatch(/échec extraction/);
});
```

Replace with:
```ts
it("laisse owners undefined et peuple ownersError si extractOwners lève une erreur", async () => {
  vi.mocked(extractOwners).mockRejectedValue(new Error("échec extraction"));
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();

  const item = useMergeStore.getState().items[0] as PdfItem;
  expect(item.owners).toBeUndefined();
  expect(item.ownersError).toMatch(/échec extraction/);
});
```

**1e. Add three new tests at the end of the `addPdfs` describe block:**

```ts
it("status est 'extracting' pendant l'extraction", async () => {
  let statusDuringExtraction: string | undefined;
  vi.mocked(extractOwners).mockImplementation(async () => {
    statusDuringExtraction = useMergeStore.getState().status;
    return { owners: [], pageOwners: new Map() };
  });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf"]);

  await useMergeStore.getState().addPdfs();
  expect(statusDuringExtraction).toBe("extracting");
});

it("les PDFs sont extraits séquentiellement dans l'ordre", async () => {
  const callOrder: string[] = [];
  vi.mocked(extractOwners).mockImplementation(async (path) => {
    callOrder.push(path as string);
    return { owners: [], pageOwners: new Map() };
  });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf"]);

  await useMergeStore.getState().addPdfs();
  expect(callOrder).toEqual(["/a.pdf", "/b.pdf", "/c.pdf"]);
});

it("status est 'idle' et progress est null après l'extraction complète", async () => {
  vi.mocked(extractOwners).mockResolvedValue({ owners: [], pageOwners: new Map() });
  vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf"]);

  await useMergeStore.getState().addPdfs();
  const { status, progress } = useMergeStore.getState();
  expect(status).toBe("idle");
  expect(progress).toBeNull();
});
```

- [ ] **Step 2: Run the updated and new tests to confirm failures**

```bash
npx vitest run src/store/useMergeStore.test.ts
```

Expected: the three new tests fail. The updated tests may hang or fail due to the old implementation.

- [ ] **Step 3: Add `extractingOwners` to strings**

In `src/strings.ts`, inside the `status` object, add after `pdfsAdded`:

```ts
extractingOwners: (done: number, total: number) =>
  `Analyse des propriétaires… ${done}/${total}`,
```

The full `status` object should look like:

```ts
status: {
  ready: "Prêt.",
  converting: "Conversion du PowerPoint en cours…",
  pptxLoaded: (count: number) =>
    `PowerPoint chargé — ${count} diapositive${count !== 1 ? "s" : ""} disponible${count !== 1 ? "s" : ""}.`,
  pdfsAdded: (count: number) =>
    `${count} PDF${count !== 1 ? "s" : ""} ajouté${count !== 1 ? "s" : ""}.`,
  extractingOwners: (done: number, total: number) =>
    `Analyse des propriétaires… ${done}/${total}`,
  preparingMerge: "Préparation de la fusion…",
  merging: (done: number, total: number) => `Fusion… ${done}/${total} pages`,
  pdfSaved: (path: string) => `✓ PDF enregistré : ${path}`,
  mergingOwner: (index: number, total: number, name: string) =>
    `Fusion ${index}/${total} — ${name}…`,
  splitSaved: (count: number, dir: string) => `✓ ${count} PDFs enregistrés dans : ${dir}`,
  ownersNotReady: "Analyse des propriétaires en cours, veuillez réessayer dans un instant.",
},
```

- [ ] **Step 4: Rewrite `addPdfs` in `useMergeStore.ts`**

Replace the entire `addPdfs` action (lines 129–167) with:

```ts
addPdfs: async (defaultPath?: string) => {
  const paths = await Bridge.pickPdfFiles(defaultPath);
  if (!paths || paths.length === 0) {
    logger.action("addPdfs:cancelled");
    return;
  }

  logger.action("addPdfs", {
    count: paths.length,
    files: paths.map((p) => p.split(/[\\/]/).pop()),
  });

  const newItems: PdfItem[] = paths.map((p) => ({
    id: uuid(),
    type: "pdf",
    pdfPath: p,
    rotation: 0,
  }));

  set((s) => ({
    items: [...s.items, ...newItems],
    status: "extracting" as const,
    statusMessage: strings.status.extractingOwners(0, newItems.length),
    progress: 0,
  }));

  let done = 0;
  for (const item of newItems) {
    try {
      const { owners, pageOwners } = await extractOwners(item.pdfPath);
      done++;
      set((s) => ({
        items: s.items.map((i) => (i.id === item.id ? { ...i, owners, pageOwners } : i)),
        progress: done / newItems.length,
        statusMessage: strings.status.extractingOwners(done, newItems.length),
      }));
    } catch (e) {
      logger.warn("addPdfs:extractOwners", `id=${item.id} — ${String(e)}`);
      done++;
      set((s) => ({
        items: s.items.map((i) => (i.id === item.id ? { ...i, ownersError: String(e) } : i)),
        progress: done / newItems.length,
        statusMessage: strings.status.extractingOwners(done, newItems.length),
      }));
    }
  }

  set({
    status: "idle",
    progress: null,
    statusMessage: strings.status.pdfsAdded(newItems.length),
  });
},
```

- [ ] **Step 5: Run all store tests**

```bash
npx vitest run src/store/useMergeStore.test.ts
```

Expected: all tests in `useMergeStore.test.ts` pass (including generate tests).

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass except the pre-existing `useTheme.test.ts` failures (unrelated localStorage mock issue that predates this branch).

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/strings.ts src/store/useMergeStore.ts src/store/useMergeStore.test.ts
git commit -m "feat: sequential owner extraction with progress bar"
```
