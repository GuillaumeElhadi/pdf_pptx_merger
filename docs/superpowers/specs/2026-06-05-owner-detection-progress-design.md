# Owner Detection: Bug Fix & Progress Bar

**Date:** 2026-06-05  
**Branch:** fix/owner-detection  
**Status:** Approved

## Problem

When 23 PDFs are added, all owner extractions are fired simultaneously via `newItems.forEach(async ...)`. Each call invokes `pdfjsLib.getDocument()`, overwhelming the pdf.js worker pool. Some promises hang indefinitely — there is no timeout or concurrency limit. Since the `generate()` guard blocks until every `PdfItem.owners !== undefined`, the user is permanently stuck seeing "Analyse des propriétaires en cours, veuillez réessayer dans un instant."

## Goal

1. Fix the extraction hang by processing PDFs sequentially.
2. Add a progress bar and status message so the user sees extraction advancing ("Analyse des propriétaires… 3/23").

## Design

### Types — `src/types/index.ts`

Add `"extracting"` to `AppStatus`:

```ts
export type AppStatus = "idle" | "converting" | "merging" | "extracting" | "error";
```

### Strings — `src/strings.ts`

Add one entry under `status`:

```ts
extractingOwners: (done: number, total: number) =>
  `Analyse des propriétaires… ${done}/${total}`,
```

### Store — `src/store/useMergeStore.ts` (`addPdfs` action)

Replace the `forEach(async ...)` pattern with a sequential `for...of` loop:

1. Pick files and create `newItems` (unchanged).
2. Append `newItems` to `items` immediately so they appear in the list.
3. Set `status: "extracting"`, `progress: 0`, `statusMessage: extractingOwners(0, N)`.
4. Loop `for (const item of newItems)`:
   - `await extractOwners(item.pdfPath)` — one at a time.
   - On success: patch item with `{ owners, pageOwners }`.
   - On error: patch item with `{ ownersError }`. Continue to next PDF.
   - Increment done counter, `set({ progress: done / total, statusMessage: extractingOwners(done, total) })`.
5. After loop: `set({ status: "idle", progress: null, statusMessage: pdfsAdded(N) })`.

The existing `progress: number | null` field is reused — the StatusBar's progress track already renders whenever `progress !== null`.

### StatusBar — `src/components/StatusBar.tsx`

Extend the spinner condition from:

```ts
status === "converting" || status === "merging"
```

to:

```ts
status === "converting" || status === "merging" || status === "extracting"
```

No other changes needed.

## Error handling

- A PDF that throws during `extractOwners` gets `ownersError` set and the loop continues. The extraction never hangs.
- PDFs with `ownersError` satisfy the `generate()` guard (it checks `owners === undefined && !ownersError`), so a single failing PDF does not block generation.

## Files changed

| File | Change |
|---|---|
| `src/types/index.ts` | Add `"extracting"` to `AppStatus` |
| `src/strings.ts` | Add `status.extractingOwners` |
| `src/store/useMergeStore.ts` | Rewrite `addPdfs` extraction loop |
| `src/components/StatusBar.tsx` | Add `"extracting"` to spinner condition |

## Out of scope

- Bounded concurrency (Approach B) — sequential is sufficient and simpler.
- Per-PDF timeout — error handling in the loop already covers stuck extractions by catching throws; a true hang at the pdf.js level would require a worker abort, which is out of scope.
- UI changes to the OwnerBanner — no changes needed.
