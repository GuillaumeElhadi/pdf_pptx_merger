/**
 * Tests ZOMBIES pour App.tsx
 *
 * App est le composant racine : il orchestre ThemeContext, useUpdater, la bannière
 * de sélection et le layout principal. Les composants enfants (TopBar, MergeList,
 * StatusBar, UpdateBanner) sont stubbés pour isoler la logique propre à App.
 *
 * Focus : bannière de sélection (selectionCount > 1) et layout de base.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { useMergeStore } from "./store/useMergeStore";
import { resetStore } from "./test/helpers";
import { strings } from "./strings";

// ── Stubs composants enfants ──────────────────────────────────────────────────
// Isolent App de toutes les dépendances de ses enfants (Bridge, dnd-kit, pdfjs…)

vi.mock("./components/TopBar/TopBar", () => ({
  TopBar: () => <div data-testid="topbar">TopBar</div>,
}));
vi.mock("./components/MergeList/MergeList", () => ({
  MergeList: () => <div data-testid="mergelist">MergeList</div>,
}));
vi.mock("./components/StatusBar", () => ({
  StatusBar: () => <div data-testid="statusbar">StatusBar</div>,
}));
vi.mock("./components/UpdateBanner", () => ({
  UpdateBanner: () => <div data-testid="updatebanner">UpdateBanner</div>,
}));

// ── Stubs hooks ───────────────────────────────────────────────────────────────

vi.mock("./hooks/useUpdater", () => ({
  useUpdater: () => ({
    update: null,
    currentVersion: "3.8.0",
    status: "idle",
    dismissed: false,
    dismiss: vi.fn(),
    undismiss: vi.fn(),
    install: vi.fn(),
  }),
}));

vi.mock("./hooks/useTheme", async () => {
  const { createContext } = await import("react");
  return {
    ThemeContext: createContext({ theme: "dark", toggleTheme: () => {} }),
    useThemeProvider: () => ({ theme: "dark", toggleTheme: () => {} }),
  };
});

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(resetStore);

// ── Z — Zero : aucune sélection ───────────────────────────────────────────────

describe("App — Z : aucune sélection", () => {
  it("n'affiche pas la bannière quand selectedIds est vide", () => {
    useMergeStore.setState({ selectedIds: new Set() });
    render(<App />);
    expect(screen.queryByText(/éléments sélectionnés/)).toBeNull();
  });

  it("n'affiche pas le bouton Désélectionner quand sélection vide", () => {
    render(<App />);
    expect(screen.queryByText("Désélectionner")).toBeNull();
  });
});

// ── O — One : un seul item sélectionné ───────────────────────────────────────

describe("App — O : un seul item sélectionné", () => {
  it("n'affiche pas la bannière pour une sélection de 1 (condition > 1)", () => {
    useMergeStore.setState({ selectedIds: new Set(["a"]) });
    render(<App />);
    expect(screen.queryByText(/éléments sélectionnés/)).toBeNull();
  });
});

// ── M — Many : sélection multiple ────────────────────────────────────────────

describe("App — M : sélection multiple", () => {
  it("affiche la bannière dès que 2 items sont sélectionnés", () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b"]) });
    render(<App />);
    expect(screen.getByText(/2 éléments sélectionnés/)).toBeInTheDocument();
  });

  it("affiche le bon compte pour une grande sélection", () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b", "c", "d", "e"]) });
    render(<App />);
    expect(screen.getByText(/5 éléments sélectionnés/)).toBeInTheDocument();
  });

  it("affiche le bouton Désélectionner", () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b"]) });
    render(<App />);
    expect(screen.getByText("Désélectionner")).toBeInTheDocument();
  });
});

// ── B — Boundaries : seuil exact ─────────────────────────────────────────────

describe("App — B : seuil de la bannière", () => {
  it("bannière absente pour selectionCount = 1", () => {
    useMergeStore.setState({ selectedIds: new Set(["x"]) });
    render(<App />);
    expect(screen.queryByText(/éléments sélectionnés/)).toBeNull();
  });

  it("bannière présente pour selectionCount = 2 (seuil exact)", () => {
    useMergeStore.setState({ selectedIds: new Set(["x", "y"]) });
    render(<App />);
    expect(screen.getByText(/2 éléments sélectionnés/)).toBeInTheDocument();
  });
});

// ── I — Interface : interactions ──────────────────────────────────────────────

describe("App — I : interaction Désélectionner", () => {
  it("clic sur Désélectionner vide selectedIds dans le store", async () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b", "c"]) });
    render(<App />);
    await userEvent.click(screen.getByText("Désélectionner"));
    expect(useMergeStore.getState().selectedIds.size).toBe(0);
  });

  it("clic sur Désélectionner fait disparaître la bannière", async () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b"]) });
    render(<App />);
    expect(screen.getByText(/2 éléments sélectionnés/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Désélectionner"));
    expect(screen.queryByText(/éléments sélectionnés/)).toBeNull();
  });
});

// ── S — Scenarios : layout général ───────────────────────────────────────────

describe("App — S : layout", () => {
  it("rend sans erreur", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("rend les composants principaux (TopBar, MergeList, StatusBar)", () => {
    render(<App />);
    expect(screen.getByTestId("topbar")).toBeInTheDocument();
    expect(screen.getByTestId("mergelist")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar")).toBeInTheDocument();
  });

  it("le texte de la bannière inclut le hint de déplacement groupé", () => {
    useMergeStore.setState({ selectedIds: new Set(["a", "b"]) });
    render(<App />);
    expect(
      screen.getByText(/déplacez l'un pour les déplacer tous/)
    ).toBeInTheDocument();
  });
});
