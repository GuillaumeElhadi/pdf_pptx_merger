# Niveau de performance configurable (pool OCR + concurrence fichiers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Laisser l'utilisateur choisir un niveau de performance (Économe / Équilibré / Performance) qui pilote à la fois la taille du pool de workers OCR et la concurrence de traitement des fichiers, avec une détection automatique du maximum disponible sur sa machine — et déplacer les toggles existants (détection propriétaires/rotation) dans la même nouvelle modal de réglages.

**Architecture:** Un nouveau module pur `performanceSettings.ts` calcule le nombre de workers pour chaque préréglage et persiste le choix en `localStorage`. `ocrExtractor.ts` expose `configureOcrWorkerPool(size)` pour recréer son pool à chaud. `useMergeStore.ts` porte l'état `performanceLevel` et calcule la concurrence fichiers dynamiquement (plus de constante figée). Une nouvelle modal `SettingsDialog` (ouverte depuis un bouton dans `TopBar`) regroupe les 2 toggles existants + un slider à 3 crans pour le niveau de performance.

**Tech Stack:** React + TypeScript, Zustand (store), Vitest + @testing-library/react (tests), `localStorage` (persistance, pas de plugin Tauri).

## Global Constraints

- Pas de redémarrage requis : un changement de réglage s'applique au prochain traitement (`processPdfItems`), pas besoin de relancer l'app.
- `OCR_WORKER_POOL_SIZE` et `FILE_PROCESSING_CONCURRENCY` restent toujours égaux entre eux (un seul réglage les pilote tous les deux).
- 3 préréglages uniquement, pas de réglage numérique libre exposé à l'utilisateur.
- Détection via `navigator.hardwareConcurrency` uniquement, fallback à `4` si absent, sans plafond artificiel.
- Limite acceptée et documentée : les workers OCR en cours d'utilisation au moment d'un changement de réglage ne sont pas interrompus ni explicitement détruits ensuite (fuite mineure acceptée, voir spec).
- Persistance via `localStorage`, même pattern que `src/hooks/useTheme.ts` (clé dédiée, pas de plugin Tauri).
- Suivre les conventions existantes : commentaires de tests ZOMBIES en français, styles React inline (`Record<string, React.CSSProperties>`), pas de librairie UI externe.

---

## Task 1: `performanceSettings.ts` — détection et mapping des préréglages

**Files:**
- Create: `src/utils/performanceSettings.ts`
- Create: `src/utils/performanceSettings.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `PerformanceLevel` (type `"economical" | "balanced" | "performance"`), `detectMaxWorkers(): number`, `workerCountForLevel(level: PerformanceLevel, maxWorkers?: number): number`, `loadPerformanceLevel(): PerformanceLevel`, `savePerformanceLevel(level: PerformanceLevel): void` — tous exportés depuis `src/utils/performanceSettings.ts`. `PerformanceLevel` est aussi ré-exporté depuis `src/types/index.ts` (même pattern que `OwnerInfo`).

- [ ] **Step 1: Write the failing tests**

Create `src/utils/performanceSettings.test.ts`:

```ts
/**
 * Tests ZOMBIES pour performanceSettings.ts
 *
 * Logique testée :
 *  - detectMaxWorkers()      : navigator.hardwareConcurrency → fallback 4
 *  - workerCountForLevel()   : mapping des 3 préréglages
 *  - loadPerformanceLevel()  : localStorage → défaut "balanced"
 *  - savePerformanceLevel()  : écriture localStorage
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectMaxWorkers,
  workerCountForLevel,
  loadPerformanceLevel,
  savePerformanceLevel,
  type PerformanceLevel,
} from "./performanceSettings";

const STORAGE_KEY = "pdf-merger-performance-level";

beforeEach(() => {
  localStorage.clear();
});

// ── detectMaxWorkers ─────────────────────────────────────────────────────────

describe("detectMaxWorkers", () => {
  it("retourne navigator.hardwareConcurrency quand disponible", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    expect(detectMaxWorkers()).toBe(8);
    vi.unstubAllGlobals();
  });

  it("retourne 4 si navigator.hardwareConcurrency est 0", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 0 });
    expect(detectMaxWorkers()).toBe(4);
    vi.unstubAllGlobals();
  });

  it("retourne 4 si navigator.hardwareConcurrency est undefined", () => {
    vi.stubGlobal("navigator", {});
    expect(detectMaxWorkers()).toBe(4);
    vi.unstubAllGlobals();
  });
});

// ── workerCountForLevel ──────────────────────────────────────────────────────

describe("workerCountForLevel", () => {
  it("economical retourne toujours 1, quel que soit maxWorkers", () => {
    expect(workerCountForLevel("economical", 8)).toBe(1);
    expect(workerCountForLevel("economical", 2)).toBe(1);
  });

  it("balanced retourne la moitié de maxWorkers arrondie", () => {
    expect(workerCountForLevel("balanced", 8)).toBe(4);
    expect(workerCountForLevel("balanced", 7)).toBe(4); // round(3.5) = 4
  });

  it("balanced ne descend jamais sous 1 (machine à 1 coeur)", () => {
    expect(workerCountForLevel("balanced", 1)).toBe(1);
  });

  it("performance retourne maxWorkers tel quel", () => {
    expect(workerCountForLevel("performance", 8)).toBe(8);
  });

  it("utilise detectMaxWorkers() par défaut si maxWorkers n'est pas fourni", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
    expect(workerCountForLevel("performance")).toBe(6);
    vi.unstubAllGlobals();
  });
});

// ── loadPerformanceLevel / savePerformanceLevel ──────────────────────────────

describe("loadPerformanceLevel — Z : rien en localStorage", () => {
  it("retourne 'balanced' par défaut", () => {
    expect(loadPerformanceLevel()).toBe("balanced");
  });
});

describe("loadPerformanceLevel — O : une valeur valide stockée", () => {
  it.each<PerformanceLevel>(["economical", "balanced", "performance"])(
    "retourne '%s' si stocké",
    (level) => {
      localStorage.setItem(STORAGE_KEY, level);
      expect(loadPerformanceLevel()).toBe(level);
    }
  );
});

describe("loadPerformanceLevel — B : valeur invalide stockée", () => {
  it("retourne 'balanced' si la valeur stockée n'est pas un niveau valide", () => {
    localStorage.setItem(STORAGE_KEY, "ultra-fast");
    expect(loadPerformanceLevel()).toBe("balanced");
  });
});

describe("savePerformanceLevel", () => {
  it("écrit le niveau choisi dans localStorage", () => {
    savePerformanceLevel("performance");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("performance");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/performanceSettings.test.ts`
Expected: FAIL — `Failed to resolve import "./performanceSettings"` (le module n'existe pas encore).

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/performanceSettings.ts`:

```ts
export type PerformanceLevel = "economical" | "balanced" | "performance";

const STORAGE_KEY = "pdf-merger-performance-level";
const VALID_LEVELS: readonly PerformanceLevel[] = ["economical", "balanced", "performance"];

/** Number of logical cores available, per the browser. Falls back to 4 if unknown/0. */
export function detectMaxWorkers(): number {
  return navigator.hardwareConcurrency || 4;
}

/**
 * Maps a qualitative performance level to a worker count.
 * - economical  → 1 (minimal resource usage)
 * - balanced    → half the available cores, rounded, never below 1
 * - performance → all available cores
 */
export function workerCountForLevel(
  level: PerformanceLevel,
  maxWorkers: number = detectMaxWorkers()
): number {
  switch (level) {
    case "economical":
      return 1;
    case "balanced":
      return Math.max(1, Math.round(maxWorkers / 2));
    case "performance":
      return maxWorkers;
  }
}

export function loadPerformanceLevel(): PerformanceLevel {
  const stored = localStorage.getItem(STORAGE_KEY);
  if ((VALID_LEVELS as string[]).includes(stored ?? "")) return stored as PerformanceLevel;
  return "balanced";
}

export function savePerformanceLevel(level: PerformanceLevel): void {
  localStorage.setItem(STORAGE_KEY, level);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/performanceSettings.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Re-export `PerformanceLevel` from `src/types/index.ts`**

Modify `src/types/index.ts` — add after the existing `OwnerInfo` import/export at the top of the file:

```ts
import type { OwnerInfo } from "../services/ownerExtractor";
import type { PerformanceLevel } from "../utils/performanceSettings";

export type { OwnerInfo, PerformanceLevel };
```

(Replaces the existing `import type { OwnerInfo } from "../services/ownerExtractor";` / `export type { OwnerInfo };` lines — merge both type imports/exports as shown.)

- [ ] **Step 6: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 7: Commit**

```bash
git add src/utils/performanceSettings.ts src/utils/performanceSettings.test.ts src/types/index.ts
git commit -m "feat: add performanceSettings module for worker count presets

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: `workerPool.ts` — `drainIdle()` pour le swap à chaud

**Files:**
- Modify: `src/utils/workerPool.ts`
- Modify: `src/utils/workerPool.test.ts`

**Interfaces:**
- Consumes: rien de nouveau (module déjà existant).
- Produces: `WorkerPool<T>.drainIdle(): T[]` — retire et retourne tous les workers actuellement inactifs (vide la liste interne `idle`), n'affecte pas les workers en cours d'acquisition.

- [ ] **Step 1: Write the failing test**

Add to `src/utils/workerPool.test.ts` (à l'intérieur du `describe("createWorkerPool", () => { ... })` existant, après le dernier test) :

```ts
  it("drainIdle() retire et retourne tous les workers inactifs", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    pool.release(w1);
    pool.release(w2);

    const drained = pool.drainIdle();
    expect(drained).toHaveLength(2);
    expect(drained).toEqual(expect.arrayContaining([w1, w2]));
  });

  it("drainIdle() n'inclut pas les workers actuellement acquis", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    pool.release(w1); // w1 idle, w2 toujours acquis

    const drained = pool.drainIdle();
    expect(drained).toEqual([w1]);
  });

  it("drainIdle() vide le pool interne — un appel suivant ne retourne rien tant qu'aucun nouveau release()", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(1, factory);

    const w1 = await pool.acquire();
    pool.release(w1);
    pool.drainIdle();

    expect(pool.drainIdle()).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/workerPool.test.ts`
Expected: FAIL — `pool.drainIdle is not a function`

- [ ] **Step 3: Implement `drainIdle()`**

Modify `src/utils/workerPool.ts` — update the `WorkerPool<T>` interface and the returned object:

```ts
export interface WorkerPool<T> {
  acquire(): Promise<T>;
  release(worker: T): void;
  drainIdle(): T[];
}
```

And in `createWorkerPool`'s returned object, add the new method alongside `acquire`/`release`:

```ts
    release(worker: T): void {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(worker);
      } else {
        idle.push(worker);
      }
    },

    drainIdle(): T[] {
      const drained = idle;
      idle = [];
      return drained;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/workerPool.test.ts`
Expected: PASS (all tests green, including the 3 new ones)

- [ ] **Step 5: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 6: Commit**

```bash
git add src/utils/workerPool.ts src/utils/workerPool.test.ts
git commit -m "feat: add drainIdle() to WorkerPool for hot pool resizing

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `ocrExtractor.ts` — pool OCR reconfigurable à chaud

**Files:**
- Modify: `src/services/ocrExtractor.ts`
- Modify: `src/services/ocrExtractor.concurrency.test.ts`

**Interfaces:**
- Consumes: `createWorkerPool`, `WorkerPool<T>.drainIdle()` (Task 2), `loadPerformanceLevel()`, `workerCountForLevel()` (Task 1).
- Produces: `configureOcrWorkerPool(size: number): void` exported from `src/services/ocrExtractor.ts`.

- [ ] **Step 1: Write the failing test**

Modify `src/services/ocrExtractor.concurrency.test.ts` — add a new test after the existing one (garde le test existant tel quel) :

```ts
import { ocrPage, configureOcrWorkerPool } from "./ocrExtractor";
```

(remplace la ligne `import { ocrPage } from "./ocrExtractor";` existante)

Puis ajoute ce nouveau test à la fin du `describe` existant :

```ts
  it("configureOcrWorkerPool(size) recrée le pool avec la nouvelle taille au prochain appel OCR", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
    mockRecognize.mockResolvedValue({ data: { text: "", confidence: 0 } });

    // Force une taille de départ connue — ne pas dépendre de la taille par défaut (qui dépend
    // de navigator.hardwareConcurrency de la machine de test) ni de l'état laissé par les
    // tests précédents de ce fichier (le pool est un singleton au niveau du module).
    configureOcrWorkerPool(2);
    await ocrPage(makePage(), "crop"); // initialise (ou réutilise) le pool de taille 2
    const callsBeforeResize = vi.mocked(createWorker).mock.calls.length;

    configureOcrWorkerPool(5); // taille différente de 2 → vrai resize garanti
    await ocrPage(makePage(), "crop"); // déclenche l'init paresseuse du nouveau pool (5 workers)
    const callsAfterResize = vi.mocked(createWorker).mock.calls.length;

    expect(callsAfterResize).toBe(callsBeforeResize + 5);
  });

  it("configureOcrWorkerPool(size) ne recrée rien si la taille est inchangée", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,abc");
    mockRecognize.mockResolvedValue({ data: { text: "", confidence: 0 } });

    configureOcrWorkerPool(3); // taille de départ connue
    await ocrPage(makePage(), "crop"); // initialise le pool de taille 3
    const callsBefore = vi.mocked(createWorker).mock.calls.length;

    configureOcrWorkerPool(3); // même taille que celle déjà active → no-op garanti

    await ocrPage(makePage(), "crop"); // réutilise un worker inactif, aucun nouvel appel
    expect(vi.mocked(createWorker).mock.calls.length).toBe(callsBefore);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/ocrExtractor.concurrency.test.ts`
Expected: FAIL — `configureOcrWorkerPool is not exported by "./ocrExtractor"` (ou erreur d'import équivalente)

- [ ] **Step 3: Implement `configureOcrWorkerPool`**

Modify `src/services/ocrExtractor.ts` — remplace le bloc d'initialisation du pool (actuellement) :

```ts
const OCR_WORKER_POOL_SIZE = 3;
```

et plus bas :

```ts
const workerPool = createWorkerPool(OCR_WORKER_POOL_SIZE, createTesseractWorker);
```

par :

```ts
import { loadPerformanceLevel, workerCountForLevel } from "../utils/performanceSettings";

/**
 * Tesseract.js workers process one recognize() job at a time each, so a single shared
 * worker serializes all OCR regardless of how many files/pages are processed "concurrently"
 * upstream. A pool lets that many OCR jobs actually run in parallel — sized to match the
 * user's chosen performance level (see useMergeStore.ts's performanceLevel), defaulting to
 * the persisted level on module load so the pool is correctly sized even before the store
 * explicitly configures it.
 */
let currentPoolSize = workerCountForLevel(loadPerformanceLevel());
let workerPool = createWorkerPool(currentPoolSize, createTesseractWorker);

/**
 * Resizes the OCR worker pool. No-op if `size` matches the current size. Idle workers from
 * the old pool are terminated immediately; workers currently mid-job are not interrupted —
 * they keep running and release back into their original (now-retired) pool, where they sit
 * unused until app restart. This is an accepted, rare-case limitation (changing the setting
 * mid-batch), not handled further to avoid extra complexity.
 */
export function configureOcrWorkerPool(size: number): void {
  if (size === currentPoolSize) return;
  const oldPool = workerPool;
  currentPoolSize = size;
  workerPool = createWorkerPool(size, createTesseractWorker);
  oldPool.drainIdle().forEach((worker) => {
    void worker.terminate();
  });
}
```

(garde la fonction `createTesseractWorker` juste au-dessus inchangée)

Puis dans `recognizePage`, remplace l'usage direct de la variable module `workerPool` pour capturer la référence du pool au moment de l'acquisition (pour que le `release()` cible bien le pool d'origine même s'il a été remplacé entre-temps) :

```ts
  let worker: Worker;
  let pool: typeof workerPool;
  try {
    pool = workerPool; // capture the pool in use at acquire time
    worker = await pool.acquire();
    console.info("[ocrPage] worker ready");
  } catch (e) {
    console.error("[ocrPage] worker pool acquire FAILED:", String(e));
    throw e;
  }
```

et dans le `finally` correspondant :

```ts
  } finally {
    pool.release(worker);
  }
```

(remplace `workerPool.release(worker);` par `pool.release(worker);`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/ocrExtractor.concurrency.test.ts src/services/ocrExtractor.test.ts`
Expected: PASS (all tests green, including the 2 new ones; existing 11 ocrExtractor.test.ts tests unaffected)

- [ ] **Step 5: Run full typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/services/ocrExtractor.ts src/services/ocrExtractor.concurrency.test.ts
git commit -m "feat: make OCR worker pool size reconfigurable at runtime

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: `useMergeStore.ts` — état `performanceLevel` et concurrence dynamique

**Files:**
- Modify: `src/store/useMergeStore.ts`
- Modify: `src/store/useMergeStore.test.ts`
- Modify: `src/test/helpers.tsx`

**Interfaces:**
- Consumes: `PerformanceLevel` (from `../types`, Task 1), `loadPerformanceLevel`, `savePerformanceLevel`, `workerCountForLevel` (from `../utils/performanceSettings`, Task 1), `configureOcrWorkerPool` (from `../services/ocrExtractor`, Task 3).
- Produces: `MergeStore.performanceLevel: PerformanceLevel`, `MergeStore.setPerformanceLevel(level: PerformanceLevel): void`.

- [ ] **Step 1: Write the failing tests**

Add to `src/store/useMergeStore.test.ts`, after the existing `describe("useMergeStore — setRotationDetectionEnabled"...)`-style blocks (anywhere after the imports/helpers, in its own `describe`) :

```ts
describe("useMergeStore — performanceLevel", () => {
  beforeEach(resetStore);

  it("démarre à 'balanced' par défaut", () => {
    expect(useMergeStore.getState().performanceLevel).toBe("balanced");
  });

  it("setPerformanceLevel met à jour le state", () => {
    useMergeStore.getState().setPerformanceLevel("performance");
    expect(useMergeStore.getState().performanceLevel).toBe("performance");
  });

  it("setPerformanceLevel persiste le choix en localStorage", () => {
    useMergeStore.getState().setPerformanceLevel("economical");
    expect(localStorage.getItem("pdf-merger-performance-level")).toBe("economical");
  });

  it("processPdfItems utilise la concurrence dérivée de performanceLevel (pas une constante figée)", async () => {
    useMergeStore.setState({ ownersDetectionEnabled: true, performanceLevel: "economical" }); // → 1 worker
    let maxConcurrent = 0;
    let active = 0;
    vi.mocked(extractOwners).mockImplementation(async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await Promise.resolve();
      active--;
      return {
        owners: [],
        pageOwners: new Map(),
        pageRotationCorrections: new Map(),
        fileMetric: emptyFileMetric(),
      };
    });
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(["/a.pdf", "/b.pdf", "/c.pdf"]);

    await useMergeStore.getState().addPdfs();

    expect(maxConcurrent).toBe(1); // niveau "economical" → concurrence de 1, jamais plus
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/useMergeStore.test.ts -t "performanceLevel"`
Expected: FAIL — `performanceLevel` is `undefined`, `setPerformanceLevel is not a function`

- [ ] **Step 3: Implement in `useMergeStore.ts`**

Modify imports at the top of `src/store/useMergeStore.ts` — replace:

```ts
import { RUN_LABEL, saveMetrics, summarizeBatch, type FileMetric } from "../utils/metrics";
import { mapWithConcurrency } from "../utils/concurrency";
import type {
  AppStatus,
  MergeItem,
  OwnerInfo,
  PdfItem,
  PptxSource,
  Rotation,
  SlideItem,
} from "../types";
```

with:

```ts
import { RUN_LABEL, saveMetrics, summarizeBatch, type FileMetric } from "../utils/metrics";
import { mapWithConcurrency } from "../utils/concurrency";
import {
  loadPerformanceLevel,
  savePerformanceLevel,
  workerCountForLevel,
} from "../utils/performanceSettings";
import { configureOcrWorkerPool } from "../services/ocrExtractor";
import type {
  AppStatus,
  MergeItem,
  OwnerInfo,
  PdfItem,
  PerformanceLevel,
  PptxSource,
  Rotation,
  SlideItem,
} from "../types";
```

Remove the now-unused module constant (it's replaced by a per-call dynamic lookup) — delete:

```ts
/**
 * Max number of PDFs processed concurrently in processPdfItems. OCR (tesseract.js) runs on a
 * single shared worker regardless of this value, so this mainly overlaps the non-OCR work
 * (pdf.js load, getTextContent, canvas rendering) of one file with the OCR wait of another.
 */
const FILE_PROCESSING_CONCURRENCY = 3;
```

In the `MergeStore` interface, add a new section after `setRotationDetectionEnabled: (enabled: boolean) => void;`:

```ts
  // ── Performance settings ─────────────────────────────────────────────────
  performanceLevel: PerformanceLevel;
  setPerformanceLevel: (level: PerformanceLevel) => void;
```

In `processPdfItems`, this is a single-line replacement — the closing `});` further down (just before `} finally {`) does **not** need to change. Replace:

```ts
        await mapWithConcurrency(targetItems, FILE_PROCESSING_CONCURRENCY, async (item) => {
```

with:

```ts
        await mapWithConcurrency(targetItems, workerCountForLevel(get().performanceLevel), async (item) => {
```

In the store's initial state object (where `ownersDetectionEnabled: false,` and `rotationDetectionEnabled: false,` are set), add:

```ts
    ownersDetectionEnabled: false,
    rotationDetectionEnabled: false,
    performanceLevel: loadPerformanceLevel(),
```

Add the action implementation, right after `setRotationDetectionEnabled`'s implementation (which ends with the closing `},` before the final `};` of the returned store object):

```ts
    // ── Performance settings ──────────────────────────────────────────────────
    setPerformanceLevel: (level) => {
      logger.action("setPerformanceLevel", { level });
      savePerformanceLevel(level);
      set({ performanceLevel: level });
      configureOcrWorkerPool(workerCountForLevel(level));
    },
```

- [ ] **Step 4: Update `resetStore()` in `src/test/helpers.tsx`**

Modify `src/test/helpers.tsx` — add `performanceLevel: "balanced"` to the `resetStore()` state object, and clear `localStorage` so each test starts from a clean persisted state:

```ts
export function resetStore() {
  localStorage.clear();
  useMergeStore.setState({
    pptxSources: [],
    items: [],
    selectedIds: new Set(),
    status: "idle",
    statusMessage: strings.status.ready,
    progress: null,
    lastOutputPath: null,
    ownersDetectionEnabled: false,
    rotationDetectionEnabled: false,
    performanceLevel: "balanced",
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/useMergeStore.test.ts`
Expected: PASS (all tests green, including the 4 new ones)

- [ ] **Step 6: Run full typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, all tests pass (watch for any other test file relying on the old `FILE_PROCESSING_CONCURRENCY` behavior or `resetStore()` shape — none currently do per earlier grep, but re-verify here)

- [ ] **Step 7: Commit**

```bash
git add src/store/useMergeStore.ts src/store/useMergeStore.test.ts src/test/helpers.tsx
git commit -m "feat: add performanceLevel store state, derive file concurrency dynamically

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `Switch.tsx` — extraction du composant interrupteur partagé

**Files:**
- Create: `src/components/Switch.tsx`
- Create: `src/components/Switch.test.tsx`

**Interfaces:**
- Produces: `Switch` component, props `{ checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }`. `TopBar.tsx` is **not** touched in this task — it still has its own duplicated switch styles until Task 7 replaces its toggle block with `SettingsDialog` (which uses `Switch`).

- [ ] **Step 1: Write the failing test**

Create `src/components/Switch.test.tsx`:

```tsx
/**
 * Tests ZOMBIES pour Switch — src/components/Switch.tsx
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch — Z : non cochée", () => {
  it("affiche le label et n'est pas cochée", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).not.toBeChecked();
  });
});

describe("Switch — O : cochée", () => {
  it("affiche l'état coché", () => {
    render(<Switch checked={true} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).toBeChecked();
  });
});

describe("Switch — interactions", () => {
  it("appelle onChange(true) au clic quand non cochée", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Mon réglage" />);
    await userEvent.click(screen.getByLabelText("Mon réglage"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch — Boundaries : disabled", () => {
  it("est désactivée quand disabled=true", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" disabled />);
    expect(screen.getByLabelText("Mon réglage")).toBeDisabled();
  });

  it("n'est pas désactivée par défaut (disabled non fourni)", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Switch.test.tsx`
Expected: FAIL — `Failed to resolve import "./Switch"`

- [ ] **Step 3: Implement `Switch.tsx`**

Create `src/components/Switch.tsx` (markup et styles repris tels quels de l'implémentation actuelle des toggles dans `TopBar.tsx`) :

```tsx
interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

export function Switch({ checked, onChange, disabled = false, label }: Props) {
  return (
    <label style={styles.toggleLabel}>
      <span style={switchTrackStyle(checked, disabled)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={styles.switchInput}
        />
        <span style={switchThumbStyle(checked)} />
      </span>
      {label}
    </label>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-title)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  switchInput: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    margin: 0,
    opacity: 0,
    cursor: "pointer",
  },
};

const SWITCH_WIDTH = 32;
const SWITCH_HEIGHT = 18;
const THUMB_SIZE = 14;
const THUMB_INSET = 2;

function switchTrackStyle(checked: boolean, disabled: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-block",
    flexShrink: 0,
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
    background: checked ? "var(--btn-generate-bg)" : "var(--btn-bg)",
    opacity: disabled ? 0.5 : 1,
    transition: "background-color 0.15s ease",
  };
}

function switchThumbStyle(checked: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: THUMB_INSET,
    left: checked ? SWITCH_WIDTH - THUMB_SIZE - THUMB_INSET : THUMB_INSET,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
    transition: "left 0.15s ease",
    pointerEvents: "none",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Switch.test.tsx`
Expected: PASS (all 5 tests green)

`TopBar.tsx` is left completely untouched in this task — it keeps its own (temporarily duplicated) copy of the switch styles until Task 7, where the whole toggle block is removed at once and replaced by `<Switch>` usage inside `SettingsDialog`. Removing anything from `TopBar.tsx` here would break its build, since its current JSX still calls `switchTrackStyle`/`switchThumbStyle` directly.

- [ ] **Step 5: Run full typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/components/Switch.tsx src/components/Switch.test.tsx
git commit -m "feat: add reusable Switch component (extracted from TopBar's inline toggle markup)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `SettingsDialog.tsx` — modal de réglages

**Files:**
- Create: `src/components/SettingsDialog.tsx`
- Create: `src/components/SettingsDialog.test.tsx`
- Modify: `src/strings.ts`

**Interfaces:**
- Consumes: `Switch` (Task 5), `useMergeStore` (`ownersDetectionEnabled`, `rotationDetectionEnabled`, `setOwnersDetectionEnabled`, `setRotationDetectionEnabled`, `performanceLevel`, `setPerformanceLevel`, `status` — Task 4), `detectMaxWorkers`, `workerCountForLevel` (Task 1).
- Produces: `SettingsDialog` component, props `{ onClose: () => void }`.

- [ ] **Step 1: Add strings to `src/strings.ts`**

Modify `src/strings.ts` — add a new top-level section, right after the `topBar: { ... }` block (before `// StatusBar`):

```ts
  // SettingsDialog
  settings: {
    title: "Réglages",
    performanceLabel: "Niveau de performance",
    levelEconomical: "Économe",
    levelBalanced: "Équilibré",
    levelPerformance: "Performance",
    performanceCaption: (workers: number, maxWorkers: number) =>
      `${workers} worker${workers !== 1 ? "s" : ""} (${maxWorkers} cœur${maxWorkers !== 1 ? "s" : ""} détecté${maxWorkers !== 1 ? "s" : ""} sur cette machine)`,
    close: "Fermer",
  },
```

Also add a tooltip string to the existing `topBar` section — add this line inside `topBar: { ... }`, right after `rotationToggle: "↻ Corriger orientation",`:

```ts
    settingsTooltip: "Réglages",
```

- [ ] **Step 2: Write the failing tests**

Create `src/components/SettingsDialog.test.tsx`:

```tsx
/**
 * Tests ZOMBIES pour SettingsDialog — src/components/SettingsDialog.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDialog } from "./SettingsDialog";
import { useMergeStore } from "../store/useMergeStore";
import { resetStore } from "../test/helpers";

beforeEach(() => {
  resetStore();
  // Only override hardwareConcurrency — replacing the whole `navigator` object (e.g. via
  // vi.stubGlobal) would strip properties userEvent relies on internally (e.g. userAgent).
  Object.defineProperty(navigator, "hardwareConcurrency", { value: 8, configurable: true });
});

describe("SettingsDialog — Z : état par défaut", () => {
  it("affiche les deux toggles non cochés", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Détecter propriétaires/)).not.toBeChecked();
    expect(screen.getByLabelText(/Corriger orientation/)).not.toBeChecked();
  });

  it("affiche le slider de performance sur 'Équilibré' par défaut", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText("Niveau de performance")).toHaveValue(1); // index 1 = balanced — toHaveValue attend un number pour un input range
  });

  it("affiche la légende avec le nombre de workers résolu (balanced, 8 coeurs → 4)", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByText(/4 workers \(8 cœurs détectés/)).toBeInTheDocument();
  });
});

describe("SettingsDialog — interactions : toggles", () => {
  it("active le toggle propriétaires au clic", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/Détecter propriétaires/));
    expect(useMergeStore.getState().ownersDetectionEnabled).toBe(true);
  });

  it("active le toggle rotation au clic", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/Corriger orientation/));
    expect(useMergeStore.getState().rotationDetectionEnabled).toBe(true);
  });

  it("désactive les deux toggles pendant un traitement en cours", () => {
    useMergeStore.setState({ status: "extracting" });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Détecter propriétaires/)).toBeDisabled();
    expect(screen.getByLabelText(/Corriger orientation/)).toBeDisabled();
  });
});

describe("SettingsDialog — interactions : niveau de performance", () => {
  it("déplacer le slider à 'Performance' (index 2) appelle setPerformanceLevel('performance')", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const slider = screen.getByLabelText("Niveau de performance");
    fireEventChange(slider, "2");
    expect(useMergeStore.getState().performanceLevel).toBe("performance");
  });

  it("met à jour la légende après changement de niveau", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const slider = screen.getByLabelText("Niveau de performance");
    fireEventChange(slider, "0"); // economical → 1 worker
    expect(screen.getByText(/1 worker \(8 cœurs détectés/)).toBeInTheDocument();
  });
});

describe("SettingsDialog — fermeture", () => {
  it("appelle onClose au clic sur le bouton Fermer", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByText("Fermer"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// fireEvent.change est utilisé directement (au lieu de userEvent) car les input range
// ne sont pas bien supportés par userEvent.type/click pour des changements de valeur discrets.
function fireEventChange(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/SettingsDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./SettingsDialog"`

- [ ] **Step 4: Implement `SettingsDialog.tsx`**

Create `src/components/SettingsDialog.tsx`:

```tsx
import { createPortal } from "react-dom";
import { useMergeStore } from "../store/useMergeStore";
import { strings } from "../strings";
import { detectMaxWorkers, workerCountForLevel } from "../utils/performanceSettings";
import { Switch } from "./Switch";
import type { PerformanceLevel } from "../types";

interface Props {
  onClose: () => void;
}

const LEVELS: PerformanceLevel[] = ["economical", "balanced", "performance"];
const LEVEL_INDEX: Record<PerformanceLevel, number> = {
  economical: 0,
  balanced: 1,
  performance: 2,
};

export function SettingsDialog({ onClose }: Props) {
  const {
    ownersDetectionEnabled,
    rotationDetectionEnabled,
    setOwnersDetectionEnabled,
    setRotationDetectionEnabled,
    performanceLevel,
    setPerformanceLevel,
    status,
  } = useMergeStore();

  const busy = status === "converting" || status === "merging" || status === "extracting";
  const maxWorkers = detectMaxWorkers();
  const resolvedWorkers = workerCountForLevel(performanceLevel, maxWorkers);

  return createPortal(
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={strings.settings.title}
      >
        <h2 style={styles.heading}>{strings.settings.title}</h2>

        <Switch
          checked={ownersDetectionEnabled}
          onChange={setOwnersDetectionEnabled}
          disabled={busy}
          label={strings.topBar.ownersToggle}
        />
        <Switch
          checked={rotationDetectionEnabled}
          onChange={setRotationDetectionEnabled}
          disabled={busy}
          label={strings.topBar.rotationToggle}
        />

        <hr style={styles.separator} />

        <div style={styles.perfSection}>
          <span style={styles.perfLabel}>{strings.settings.performanceLabel}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={LEVEL_INDEX[performanceLevel]}
            onChange={(e) => setPerformanceLevel(LEVELS[Number(e.target.value)])}
            style={styles.range}
            aria-label={strings.settings.performanceLabel}
          />
          <div style={styles.perfTicks}>
            <span>{strings.settings.levelEconomical}</span>
            <span>{strings.settings.levelBalanced}</span>
            <span>{strings.settings.levelPerformance}</span>
          </div>
          <p style={styles.perfCaption}>
            {strings.settings.performanceCaption(resolvedWorkers, maxWorkers)}
          </p>
        </div>

        <button style={styles.closeBtn} onClick={onClose}>
          {strings.settings.close}
        </button>
      </div>
    </div>,
    document.body
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    background: "var(--bg-bar)",
    border: "1px solid var(--border-bar)",
    borderRadius: 8,
    padding: 20,
    width: 360,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  heading: {
    margin: 0,
    fontSize: 16,
    color: "var(--text-title)",
  },
  separator: {
    border: "none",
    borderTop: "1px solid var(--border-bar)",
    margin: 0,
  },
  perfSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  perfLabel: {
    fontSize: 12,
    color: "var(--text-title)",
  },
  range: {
    width: "100%",
  },
  perfTicks: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  perfCaption: {
    margin: 0,
    fontSize: 11,
    color: "var(--text-muted)",
  },
  closeBtn: {
    padding: "6px 14px",
    border: "none",
    borderRadius: 4,
    background: "var(--btn-bg)",
    color: "var(--btn-text)",
    cursor: "pointer",
    fontSize: 13,
    alignSelf: "flex-end",
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/SettingsDialog.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 6: Run full typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsDialog.tsx src/components/SettingsDialog.test.tsx src/strings.ts
git commit -m "feat: add SettingsDialog with detection toggles and performance slider

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `TopBar.tsx` — bouton réglages, retrait des toggles inline

**Files:**
- Modify: `src/components/TopBar/TopBar.tsx`
- Modify: `src/components/TopBar/TopBar.test.tsx`

**Interfaces:**
- Consumes: `SettingsDialog` (Task 6).

- [ ] **Step 1: Write the failing tests**

Modify `src/components/TopBar/TopBar.test.tsx` — replace this entire block (the last `describe` in the file, lines ~102-127):

```tsx
describe("TopBar — toggles de détection", () => {
  it("affiche les deux toggles désactivés par défaut", () => {
    renderTopBar();
    expect(screen.getByLabelText(/Détecter propriétaires/)).not.toBeChecked();
    expect(screen.getByLabelText(/Corriger orientation/)).not.toBeChecked();
  });

  it("active le toggle propriétaires au clic", async () => {
    renderTopBar();
    await userEvent.click(screen.getByLabelText(/Détecter propriétaires/));
    expect(useMergeStore.getState().ownersDetectionEnabled).toBe(true);
  });

  it("active le toggle rotation au clic", async () => {
    renderTopBar();
    await userEvent.click(screen.getByLabelText(/Corriger orientation/));
    expect(useMergeStore.getState().rotationDetectionEnabled).toBe(true);
  });

  it("désactive les deux toggles pendant la conversion", () => {
    useMergeStore.setState({ status: "converting" });
    renderTopBar();
    expect(screen.getByLabelText(/Détecter propriétaires/)).toBeDisabled();
    expect(screen.getByLabelText(/Corriger orientation/)).toBeDisabled();
  });
});
```

with:

```tsx
describe("TopBar — bouton réglages", () => {
  it("n'affiche pas la modal de réglages par défaut", () => {
    renderTopBar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ouvre la modal de réglages au clic sur le bouton réglages", async () => {
    renderTopBar();
    await userEvent.click(screen.getByTitle("Réglages"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("les toggles de détection sont accessibles depuis la modal de réglages", async () => {
    renderTopBar();
    await userEvent.click(screen.getByTitle("Réglages"));
    expect(screen.getByLabelText(/Détecter propriétaires/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Corriger orientation/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/TopBar/TopBar.test.tsx`
Expected: FAIL — bouton avec le titre "Réglages" introuvable

- [ ] **Step 3: Implement in `TopBar.tsx`**

Modify `src/components/TopBar/TopBar.tsx` — update imports at the top:

```ts
import { useEffect, useState } from "react";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";
import { strings } from "../../strings";
import { useTheme } from "../../hooks/useTheme";
import { SettingsDialog } from "../SettingsDialog";
```

Update the destructured store values — replace:

```ts
  const {
    pptxSources,
    items,
    status,
    loadPptx,
    addPdfs,
    ownersDetectionEnabled,
    rotationDetectionEnabled,
    setOwnersDetectionEnabled,
    setRotationDetectionEnabled,
  } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
```

with:

```ts
  const { pptxSources, items, status, loadPptx, addPdfs } = useMergeStore();
  const [googleDrivePath, setGoogleDrivePath] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
```

Remove the toggle JSX block entirely — delete:

```tsx
      <div style={styles.toggleGroup}>
        <label style={styles.toggleLabel}>
          <span style={switchTrackStyle(ownersDetectionEnabled, busy)}>
            <input
              type="checkbox"
              checked={ownersDetectionEnabled}
              onChange={(e) => setOwnersDetectionEnabled(e.target.checked)}
              disabled={busy}
              style={styles.switchInput}
            />
            <span style={switchThumbStyle(ownersDetectionEnabled)} />
          </span>
          {strings.topBar.ownersToggle}
        </label>
        <label style={styles.toggleLabel}>
          <span style={switchTrackStyle(rotationDetectionEnabled, busy)}>
            <input
              type="checkbox"
              checked={rotationDetectionEnabled}
              onChange={(e) => setRotationDetectionEnabled(e.target.checked)}
              disabled={busy}
              style={styles.switchInput}
            />
            <span style={switchThumbStyle(rotationDetectionEnabled)} />
          </span>
          {strings.topBar.rotationToggle}
        </label>
      </div>
```

Add a settings button right before the existing theme button — replace:

```tsx
      <button
        style={styles.themeBtn}
        onClick={toggleTheme}
        title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      >
        {theme === "dark" ? "☀" : "🌙"}
      </button>
    </header>
  );
}
```

with:

```tsx
      <button
        style={styles.themeBtn}
        onClick={() => setIsSettingsOpen(true)}
        title={strings.topBar.settingsTooltip}
      >
        🛠
      </button>

      <button
        style={styles.themeBtn}
        onClick={toggleTheme}
        title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      >
        {theme === "dark" ? "☀" : "🌙"}
      </button>

      {isSettingsOpen && <SettingsDialog onClose={() => setIsSettingsOpen(false)} />}
    </header>
  );
}
```

Remove the now-unused `toggleGroup`, `toggleLabel`, and `switchInput` entries from the `styles` object — delete:

```ts
  toggleGroup: {
    display: "flex",
    gap: 12,
    flexShrink: 0,
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-title)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  switchInput: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    margin: 0,
    opacity: 0,
    cursor: "pointer",
  },
```

`tsconfig.json` has `noUnusedLocals: true`, so the now-unused `switchTrackStyle`/`switchThumbStyle` functions and their 4 size constants must also be removed or `tsc` will fail. Delete this block entirely from the bottom of the file:

```ts
const SWITCH_WIDTH = 32;
const SWITCH_HEIGHT = 18;
const THUMB_SIZE = 14;
const THUMB_INSET = 2;

function switchTrackStyle(checked: boolean, disabled: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-block",
    flexShrink: 0,
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: SWITCH_HEIGHT / 2,
    background: checked ? "var(--btn-generate-bg)" : "var(--btn-bg)",
    opacity: disabled ? 0.5 : 1,
    transition: "background-color 0.15s ease",
  };
}

function switchThumbStyle(checked: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: THUMB_INSET,
    left: checked ? SWITCH_WIDTH - THUMB_SIZE - THUMB_INSET : THUMB_INSET,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
    transition: "left 0.15s ease",
    pointerEvents: "none",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/TopBar/TopBar.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 5: Run full typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, all tests pass — no leftover references to `ownersDetectionEnabled`/`rotationDetectionEnabled`/`setOwnersDetectionEnabled`/`setRotationDetectionEnabled`/`switchTrackStyle`/`switchThumbStyle` inside `TopBar.tsx`

- [ ] **Step 6: Manual smoke check**

Run: `npm run tauri dev`
- Click the 🛠 button in the top bar → the settings modal opens, showing both toggles and the performance slider.
- Drag the slider across its 3 positions → the caption text updates to reflect the new worker count.
- Click "Fermer" → the modal closes.
- Click outside the modal panel (on the overlay) → the modal closes.

- [ ] **Step 7: Commit**

```bash
git add src/components/TopBar/TopBar.tsx src/components/TopBar/TopBar.test.tsx
git commit -m "feat: move detection toggles into SettingsDialog, add settings button to TopBar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
