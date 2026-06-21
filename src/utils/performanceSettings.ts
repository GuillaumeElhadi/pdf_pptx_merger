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
