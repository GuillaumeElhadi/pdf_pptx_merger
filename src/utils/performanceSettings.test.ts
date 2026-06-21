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
