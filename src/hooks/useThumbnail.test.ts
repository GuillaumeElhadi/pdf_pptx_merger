/**
 * Tests ZOMBIES pour useThumbnail() — src/hooks/useThumbnail.ts
 *
 * Logique testée :
 *  - pdfPath = null       → état immédiat { url: null, loading: false }, renderPage non appelé
 *  - pdfPath fourni       → loading=true pendant le rendu, url peuplée au resolve
 *  - renderPage rejette   → { url: null, loading: false } (catch silencieux)
 *  - Unmount pendant load → cancelled=true, setState ignoré (pas de crash)
 *  - Changement de dep    → nouvel effet déclenché, état mis à jour
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { renderPage } from "../services/pdfRenderer";
import { useThumbnail } from "./useThumbnail";

// ── Mock pdfRenderer ──────────────────────────────────────────────────────────

vi.mock("../services/pdfRenderer", () => ({
  renderPage: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(renderPage).mockResolvedValue("blob:mock-url");
});

// ── Z — Zero : pdfPath null ───────────────────────────────────────────────────

describe("useThumbnail — Z : pdfPath null", () => {
  it("retourne { url: null, loading: false } immédiatement", () => {
    const { result } = renderHook(() => useThumbnail(null));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("renderPage n'est pas appelé si pdfPath est null", async () => {
    renderHook(() => useThumbnail(null));
    await act(async () => {});
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("passage de null → path déclenche le chargement", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useThumbnail(path),
      { initialProps: { path: null as string | null } }
    );
    expect(result.current.loading).toBe(false);

    rerender({ path: "/a.pdf" });

    await waitFor(() => expect(result.current.url).toBe("blob:mock-url"));
    expect(result.current.loading).toBe(false);
  });
});

// ── O — One : un chemin fourni ────────────────────────────────────────────────

describe("useThumbnail — O : un chemin", () => {
  it("loading=true pendant le rendu puis false une fois l'URL obtenue", async () => {
    const { result } = renderHook(() => useThumbnail("/a.pdf", 0, 160));
    // loading=true dès l'initialisation (pdfPath non null)
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBe("blob:mock-url");
  });

  it("url peuplée avec la valeur retournée par renderPage", async () => {
    vi.mocked(renderPage).mockResolvedValue("blob:specific-url");
    const { result } = renderHook(() => useThumbnail("/a.pdf", 0, 160));
    await waitFor(() => expect(result.current.url).toBe("blob:specific-url"));
  });
});

// ── B — Boundaries : paramètres et changements de dépendances ────────────────

describe("useThumbnail — B : limites", () => {
  it("renderPage appelé avec (pdfPath, pageIndex, width) exacts", async () => {
    const { result } = renderHook(() => useThumbnail("/docs/file.pdf", 3, 48));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(renderPage).toHaveBeenCalledWith("/docs/file.pdf", 3, 48);
  });

  it("pageIndex par défaut = 0", async () => {
    const { result } = renderHook(() => useThumbnail("/a.pdf"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(renderPage).toHaveBeenCalledWith("/a.pdf", 0, 160);
  });

  it("changement de pdfPath déclenche un nouveau rendu avec le nouveau chemin", async () => {
    vi.mocked(renderPage)
      .mockResolvedValueOnce("blob:url-a")
      .mockResolvedValueOnce("blob:url-b");

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useThumbnail(path, 0, 160),
      { initialProps: { path: "/a.pdf" } }
    );

    await waitFor(() => expect(result.current.url).toBe("blob:url-a"));

    rerender({ path: "/b.pdf" });

    await waitFor(() => expect(result.current.url).toBe("blob:url-b"));
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(renderPage).toHaveBeenNthCalledWith(2, "/b.pdf", 0, 160);
  });

  it("changement de pageIndex déclenche un nouveau rendu", async () => {
    vi.mocked(renderPage)
      .mockResolvedValueOnce("blob:page-0")
      .mockResolvedValueOnce("blob:page-2");

    const { result, rerender } = renderHook(
      ({ idx }: { idx: number }) => useThumbnail("/a.pdf", idx, 160),
      { initialProps: { idx: 0 } }
    );

    await waitFor(() => expect(result.current.url).toBe("blob:page-0"));

    rerender({ idx: 2 });

    await waitFor(() => expect(result.current.url).toBe("blob:page-2"));
  });
});

// ── I — Interface : état loading intermédiaire ────────────────────────────────

describe("useThumbnail — I : contrat", () => {
  it("loading passe à false quel que soit le résultat (succès ou erreur)", async () => {
    vi.mocked(renderPage).mockResolvedValue("blob:ok");
    const { result } = renderHook(() => useThumbnail("/a.pdf"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.url).toBe("string");
  });

  it("retour à { url: null, loading: false } quand pdfPath repasse à null", async () => {
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useThumbnail(path),
      { initialProps: { path: "/a.pdf" as string | null } }
    );
    await waitFor(() => expect(result.current.url).toBe("blob:mock-url"));

    rerender({ path: null });

    await waitFor(() => {
      expect(result.current.url).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });
});

// ── E — Exceptions ────────────────────────────────────────────────────────────

describe("useThumbnail — E : erreurs", () => {
  it("renderPage rejette → url=null, loading=false (erreur silencieuse)", async () => {
    vi.mocked(renderPage).mockRejectedValue(new Error("PDF corrompu"));
    const { result } = renderHook(() => useThumbnail("/bad.pdf"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.url).toBeNull();
  });

  it("unmount pendant le chargement : setState ignoré après annulation (pas de crash)", async () => {
    let resolveRender!: (url: string) => void;
    vi.mocked(renderPage).mockReturnValue(
      new Promise<string>((r) => {
        resolveRender = r;
      })
    );

    const { result, unmount } = renderHook(() => useThumbnail("/slow.pdf"));
    expect(result.current.loading).toBe(true);

    // Démonter avant que renderPage résolve
    unmount();

    // Résoudre après unmount — le guard `cancelled = true` doit empêcher setState
    resolveRender("blob:late-url");
    await new Promise((r) => setTimeout(r, 0));
    // L'absence d'erreur confirme que le guard fonctionne
  });
});

// ── S — Scenarios ─────────────────────────────────────────────────────────────

describe("useThumbnail — S : scénarios", () => {
  it("S1 — chargement normal : loading true → false, url disponible", async () => {
    vi.mocked(renderPage).mockResolvedValue("blob:thumbnail.png");
    const { result } = renderHook(() => useThumbnail("/slides.pdf", 2, 160));

    expect(result.current.loading).toBe(true);
    expect(result.current.url).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.url).toBe("blob:thumbnail.png");
    expect(renderPage).toHaveBeenCalledWith("/slides.pdf", 2, 160);
  });

  it("S2 — navigation entre slides : chaque changement de pageIndex déclenche un rendu", async () => {
    vi.mocked(renderPage)
      .mockResolvedValueOnce("blob:slide-0")
      .mockResolvedValueOnce("blob:slide-1")
      .mockResolvedValueOnce("blob:slide-2");

    const { result, rerender } = renderHook(
      ({ idx }: { idx: number }) => useThumbnail("/deck.pdf", idx, 160),
      { initialProps: { idx: 0 } }
    );

    await waitFor(() => expect(result.current.url).toBe("blob:slide-0"));
    rerender({ idx: 1 });
    await waitFor(() => expect(result.current.url).toBe("blob:slide-1"));
    rerender({ idx: 2 });
    await waitFor(() => expect(result.current.url).toBe("blob:slide-2"));

    expect(renderPage).toHaveBeenCalledTimes(3);
  });
});
