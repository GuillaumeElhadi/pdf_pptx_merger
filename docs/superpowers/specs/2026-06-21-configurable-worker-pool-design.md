# Design — Niveau de performance configurable (pool OCR + concurrence fichiers)

Date: 2026-06-21

## Contexte

Le pipeline d'extraction des propriétaires (`ownerExtractor.ts`) utilise un pool de workers Tesseract (`ocrExtractor.ts`, taille fixe `OCR_WORKER_POOL_SIZE = 3`) et un niveau de concurrence fichiers (`useMergeStore.ts`, `FILE_PROCESSING_CONCURRENCY = 3`) introduits lors d'une série d'optimisations de performance. Ces deux constantes sont actuellement figées dans le code et identiques entre elles.

Cette feature rend ce réglage configurable par l'utilisateur, avec une détection automatique du maximum disponible sur sa machine, afin que la performance s'adapte à la configuration matérielle de chacun (machine à 2 cœurs vs machine à 16 cœurs).

À l'occasion de cette feature, les deux toggles existants (détection propriétaires, détection rotation — actuellement dans `TopBar.tsx`) sont déplacés dans la même nouvelle modal de réglages, pour consolider tous les réglages de traitement à un seul endroit.

## Périmètre

- Un seul réglage utilisateur ("niveau de performance") pilote à la fois la taille du pool de workers OCR et la concurrence de traitement des fichiers — les deux valeurs restent toujours égales.
- 3 préréglages qualitatifs : Économe / Équilibré / Performance (pas de réglage numérique fin exposé à l'utilisateur, bien qu'affiché en légende informative).
- Détection automatique du maximum via `navigator.hardwareConcurrency`, sans plafond artificiel.
- Application immédiate au prochain traitement (pas de redémarrage requis).
- Déplacement des toggles propriétaires/rotation dans la même modal.

Hors périmètre :
- Réglage numérique fin (slider libre 1 à N) — seuls les 3 préréglages sont exposés.
- Nettoyage garanti des workers OCR en vol au moment d'un changement de réglage pendant un traitement actif (limite acceptée, voir section Limites).
- Tout réglage de performance pour la conversion PPTX→PDF ou le split/merge PDF (hors sujet — uniquement le pipeline d'extraction owner/rotation).

## Architecture

### Nouveau module : `src/utils/performanceSettings.ts`

Logique pure, sans dépendance React ni Tauri (hormis `localStorage`, disponible nativement dans la webview).

```ts
export type PerformanceLevel = "economical" | "balanced" | "performance";

export function detectMaxWorkers(): number;
// navigator.hardwareConcurrency || 4 (fallback si l'API n'est pas exposée)

export function workerCountForLevel(level: PerformanceLevel, maxWorkers?: number): number;
// economical  → 1
// balanced    → max(1, round(maxWorkers / 2))
// performance → maxWorkers
// maxWorkers par défaut = detectMaxWorkers()

export function loadPerformanceLevel(): PerformanceLevel;
// lit "pdf-merger-performance-level" dans localStorage, défaut "balanced" si absent/invalide

export function savePerformanceLevel(level: PerformanceLevel): void;
// écrit dans localStorage
```

Pattern de persistance identique à `useTheme.ts` (clé `localStorage` dédiée, pas de plugin Tauri).

### `ocrExtractor.ts` — pool reconfigurable

Le pool de workers OCR (`createWorkerPool`, déjà en place depuis l'optimisation précédente) devient mutable au lieu d'être une constante figée au chargement du module :

```ts
let currentPoolSize = workerCountForLevel(loadPerformanceLevel());
let workerPool = createWorkerPool(currentPoolSize, createTesseractWorker);

export function configureOcrWorkerPool(size: number): void {
  if (size === currentPoolSize) return; // no-op si inchangé
  const oldPool = workerPool;
  currentPoolSize = size;
  workerPool = createWorkerPool(size, createTesseractWorker);
  oldPool.drainIdle().forEach((worker) => worker.terminate());
}
```

`WorkerPool<T>` (dans `src/utils/workerPool.ts`) gagne une méthode `drainIdle(): T[]` qui retire et retourne tous les workers actuellement inactifs du pool (sans affecter ceux en cours d'acquisition — voir Limites).

Le pool s'initialise par défaut avec le niveau persisté dès le chargement du module (pas besoin d'attendre que le store appelle `configureOcrWorkerPool` au démarrage) — garantit un comportement correct même dans des contextes qui n'utilisent pas le store (tests, scripts).

### `useMergeStore.ts` — état et action

```ts
performanceLevel: PerformanceLevel; // initialisé via loadPerformanceLevel()
setPerformanceLevel: (level: PerformanceLevel) => void;
```

`setPerformanceLevel`:
1. `savePerformanceLevel(level)`
2. `set({ performanceLevel: level })`
3. `configureOcrWorkerPool(workerCountForLevel(level))`

La constante module `FILE_PROCESSING_CONCURRENCY` est supprimée ; `processPdfItems` calcule la concurrence à utiliser via `workerCountForLevel(get().performanceLevel)` au moment de l'appel à `mapWithConcurrency`, donc toujours à jour avec le réglage courant.

### UI — `SettingsDialog.tsx` (nouveau) + `TopBar.tsx` (modifié)

**TopBar** : les 2 toggles (`toggleGroup`) sont retirés. Un bouton icône ⚙️ est ajouté (même style que le bouton thème existant), qui ouvre `SettingsDialog` (état local `isSettingsOpen` dans `TopBar`).

**SettingsDialog** : modal simple (overlay + panneau centré, pas de librairie de modal externe — pattern à la main cohérent avec le reste de l'app qui n'utilise pas de librairie UI).

Contenu :
1. Toggle "Détection des propriétaires" (déplacé tel quel depuis `TopBar`, même style switch, même binding `ownersDetectionEnabled`/`setOwnersDetectionEnabled`).
2. Toggle "Détection de rotation" (idem, `rotationDetectionEnabled`/`setRotationDetectionEnabled`).
3. Séparateur visuel.
4. `<input type="range" min={0} max={2} step={1}>` mappé sur les 3 niveaux (0=economical, 1=balanced, 2=performance), avec les 3 labels affichés sous le curseur.
5. Légende dynamique : `"{Label} : {N} worker(s) ({maxWorkers} cœurs détectés sur cette machine)"`.
6. Bouton de fermeture.

Pendant qu'un traitement est en cours (`busy`), les toggles restent désactivés comme aujourd'hui ; le range de performance reste actif (changer le niveau pendant un traitement est autorisé, voir Limites).

## Limites acceptées

Si l'utilisateur change le niveau de performance **pendant** qu'une extraction est en cours, les workers OCR actuellement occupés (en train de traiter une page) à ce moment ne sont pas interrompus — ils terminent leur tâche, mais ne sont pas explicitement détruits ensuite : `release()` les remettrait dans l'ancien pool, qui n'est plus jamais sollicité. Ils restent donc en mémoire jusqu'au redémarrage de l'application.

C'est un cas rare (changer un réglage de perf en plein traitement) avec un impact mineur (quelques dizaines de Mo par worker orphelin, borné par l'ancienne taille de pool). Pas de nettoyage actif de ce cas pour ne pas complexifier `workerPool.ts` davantage.

## Tests

- **`performanceSettings.test.ts`** (TDD, pur) : mapping des 3 niveaux → nombre de workers (avec `maxWorkers` injecté), fallback `detectMaxWorkers()` si `navigator.hardwareConcurrency` est `undefined`, `loadPerformanceLevel`/`savePerformanceLevel` via `localStorage` mocké (pattern `useTheme.test.ts`), valeur par défaut "balanced" si absent ou invalide.
- **`workerPool.test.ts`** : nouvelle méthode `drainIdle()` — retourne et vide les workers inactifs, n'affecte pas les workers actuellement acquis.
- **`ocrExtractor.test.ts`** (ou fichier dédié comme `ocrExtractor.concurrency.test.ts`) : `configureOcrWorkerPool(size)` recrée le pool avec la nouvelle taille (vérifié via le nombre d'appels à `createWorker`), no-op si la taille est inchangée, termine les workers inactifs de l'ancien pool.
- **`useMergeStore.test.ts`** : `setPerformanceLevel()` persiste (vérifie l'appel à `localStorage`/le mock du module), met à jour le state, appelle `configureOcrWorkerPool` avec la bonne valeur ; `processPdfItems` utilise la concurrence dérivée du niveau courant (test avec un niveau non-défaut pour vérifier que ce n'est plus une constante figée).
- **`SettingsDialog.test.tsx`** (nouveau) : rendu des 2 toggles (bindings corrects vers le store), rendu du range et de sa légende, changement de valeur du range appelle `setPerformanceLevel` avec le bon niveau, bouton de fermeture déclenche le callback de fermeture.
- **`TopBar.test.tsx`** : mis à jour — suppression des assertions sur les toggles (déplacés), nouveau test confirmant que le bouton ⚙️ ouvre `SettingsDialog`.
