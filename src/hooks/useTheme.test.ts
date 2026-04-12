/**
 * Tests ZOMBIES pour useThemeProvider() — src/hooks/useTheme.ts
 *
 * Logique testée :
 *  - getInitialTheme() : localStorage → matchMedia → "dark" par défaut
 *  - applyTheme()       : setAttribute("data-theme", ...) sur <html>
 *  - useThemeProvider() : état, toggle, persistance localStorage, effet de bord DOM
 *
 * jsdom fournit localStorage et document.documentElement.
 * window.matchMedia est absent de jsdom → mocké avant chaque test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useThemeProvider } from "./useTheme";

const STORAGE_KEY = "pdf-merger-theme";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simule window.matchMedia avec une préférence donnée. */
function mockMatchMedia(prefersLight: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: prefersLight,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // Préférence système neutre par défaut (dark)
  mockMatchMedia(false);
});

// ── Z — Zero : aucune préférence stockée ─────────────────────────────────────

describe("useThemeProvider — Z : aucune préférence", () => {
  it("démarre en 'dark' par défaut (localStorage vide, matchMedia = dark)", () => {
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("dark");
  });

  it("applique data-theme='dark' sur <html> dès l'initialisation", () => {
    renderHook(() => useThemeProvider());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

// ── O — One : une préférence stockée ─────────────────────────────────────────

describe("useThemeProvider — O : localStorage existant", () => {
  it("charge 'dark' depuis localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("dark");
  });

  it("charge 'light' depuis localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("light");
  });

  it("ignore les valeurs invalides dans localStorage et revient à matchMedia", () => {
    localStorage.setItem(STORAGE_KEY, "invalid-value");
    mockMatchMedia(true); // préfère light
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("light");
  });
});

// ── B — Boundaries : matchMedia et toggle ────────────────────────────────────

describe("useThemeProvider — B : limites", () => {
  it("matchMedia prefers-color-scheme: light → démarre en 'light'", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("light");
  });

  it("matchMedia prefers-color-scheme: dark → démarre en 'dark'", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("dark");
  });

  it("localStorage a priorité sur matchMedia", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    mockMatchMedia(false); // matchMedia dirait dark, mais localStorage dit light
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("light");
  });

  it("toggle fait le cycle complet dark → light → dark", () => {
    const { result } = renderHook(() => useThemeProvider());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("light");

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe("dark");
  });
});

// ── I — Interface : effets de bord DOM et localStorage ───────────────────────

describe("useThemeProvider — I : effets de bord", () => {
  it("data-theme sur <html> reflète le thème courant", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    renderHook(() => useThemeProvider());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("toggle met à jour data-theme sur <html>", async () => {
    const { result } = renderHook(() => useThemeProvider());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("toggle persiste le nouveau thème dans localStorage", () => {
    const { result } = renderHook(() => useThemeProvider());

    act(() => result.current.toggleTheme());

    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("thème initial persisté dans localStorage via l'effet", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    renderHook(() => useThemeProvider());
    // L'effet confirme la valeur en storage (pas de changement mais toujours écrit)
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });
});

// ── S — Scenarios : flux utilisateur ─────────────────────────────────────────

describe("useThemeProvider — S : scénarios", () => {
  it("S1 — retour utilisateur avec 'light' sauvegardé : charge light, applique data-theme", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    renderHook(() => useThemeProvider());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("S2 — utilisateur toggle dark→light : data-theme et localStorage mis à jour", () => {
    const { result } = renderHook(() => useThemeProvider());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });
});
