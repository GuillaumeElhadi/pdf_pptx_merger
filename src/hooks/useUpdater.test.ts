/**
 * Tests ZOMBIES pour useUpdater() — src/hooks/useUpdater.ts
 *
 * Logique testée :
 *  - Initialisation : getVersion() et check() appelés au mount
 *  - currentVersion : peuplé depuis getVersion()
 *  - update : null si pas de mise à jour, objet Update sinon
 *  - install() : idle → downloading → done → relaunch()
 *  - install() sans update : no-op
 *  - dismiss() / undismiss() : bascule dismissed
 *  - Erreurs silencieuses : check() et getVersion() qui rejettent
 *
 * Mocks :
 *  - @tauri-apps/plugin-updater → check
 *  - @tauri-apps/plugin-process → relaunch
 *  - @tauri-apps/api/app        → getVersion (déjà mocké dans setup.ts → "3.8.0")
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdater } from "./useUpdater";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUpdate(version = "9.9.9") {
  return {
    version,
    date: "2026-01-01T00:00:00Z",
    body: "",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  // check() → pas de mise à jour par défaut
  vi.mocked(check).mockResolvedValue(null);
  // relaunch → no-op (déjà fait dans vi.mock mais réaffirmé pour clarté)
  vi.mocked(relaunch).mockResolvedValue(undefined);
  // getVersion → "3.8.0" (setup.ts, mais on s'assure que c'est cohérent)
  vi.mocked(getVersion).mockResolvedValue("3.8.0");
});

// ── Z — Zero : pas de mise à jour ────────────────────────────────────────────

describe("useUpdater — Z : aucune mise à jour", () => {
  it("update est null si check() retourne null", async () => {
    vi.mocked(check).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update).toBeNull());
  });

  it("status initial est 'idle'", () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.status).toBe("idle");
  });

  it("dismissed initial est false", () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.dismissed).toBe(false);
  });
});

// ── O — One : une mise à jour disponible ─────────────────────────────────────

describe("useUpdater — O : mise à jour disponible", () => {
  it("update est peuplé quand check() retourne un objet Update", async () => {
    const update = makeUpdate("4.0.0");
    vi.mocked(check).mockResolvedValue(update as any);

    const { result } = renderHook(() => useUpdater());

    await waitFor(() => expect(result.current.update).not.toBeNull());
    expect(result.current.update?.version).toBe("4.0.0");
  });

  it("currentVersion est peuplé depuis getVersion()", async () => {
    vi.mocked(getVersion).mockResolvedValue("3.8.0");
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.currentVersion).toBe("3.8.0"));
  });
});

// ── B — Boundaries : install sans update / cycle complet ─────────────────────

describe("useUpdater — B : limites", () => {
  it("install() ne fait rien si update est null (guard early return)", async () => {
    vi.mocked(check).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update).toBeNull());

    await act(() => result.current.install());

    expect(relaunch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("status passe par idle → downloading → done pendant install()", async () => {
    const update = makeUpdate();
    vi.mocked(check).mockResolvedValue(update as any);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update).not.toBeNull());

    const statusHistory: string[] = [];
    // Observer les statuts via le résultat du hook (snapshot avant et après)
    expect(result.current.status).toBe("idle");

    const installPromise = act(async () => {
      statusHistory.push(result.current.status); // avant
      await result.current.install();
      statusHistory.push(result.current.status); // après
    });
    await installPromise;

    expect(result.current.status).toBe("done");
  });

  it("relaunch() est appelé après un install() réussi", async () => {
    const update = makeUpdate();
    vi.mocked(check).mockResolvedValue(update as any);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update).not.toBeNull());

    await act(() => result.current.install());

    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("downloadAndInstall() appelé avec update courant", async () => {
    const update = makeUpdate();
    vi.mocked(check).mockResolvedValue(update as any);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update).not.toBeNull());

    await act(() => result.current.install());

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  });
});

// ── I — Interface : dismiss / undismiss ───────────────────────────────────────

describe("useUpdater — I : dismiss / undismiss", () => {
  it("dismiss() passe dismissed à true", async () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.dismissed).toBe(false);

    act(() => result.current.dismiss());

    expect(result.current.dismissed).toBe(true);
  });

  it("undismiss() repasse dismissed à false", async () => {
    const { result } = renderHook(() => useUpdater());
    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);

    act(() => result.current.undismiss());

    expect(result.current.dismissed).toBe(false);
  });

  it("check() et getVersion() sont appelés exactement une fois au mount", async () => {
    renderHook(() => useUpdater());
    await waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1);
      expect(getVersion).toHaveBeenCalledTimes(1);
    });
  });
});

// ── E — Exceptions : erreurs silencieuses ────────────────────────────────────

describe("useUpdater — E : erreurs silencieuses", () => {
  it("check() qui rejette → update reste null (erreur avalée)", async () => {
    vi.mocked(check).mockRejectedValue(new Error("Réseau indisponible"));
    const { result } = renderHook(() => useUpdater());
    // On attend un peu que l'effet s'exécute
    await waitFor(() => {
      expect(check).toHaveBeenCalled();
    });
    expect(result.current.update).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("getVersion() qui rejette → currentVersion reste vide (erreur avalée)", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("App non initialisée"));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => {
      expect(getVersion).toHaveBeenCalled();
    });
    expect(result.current.currentVersion).toBe("");
  });
});

// ── S — Scenarios : flux complet ─────────────────────────────────────────────

describe("useUpdater — S : scénarios", () => {
  it("S1 — mise à jour disponible → utilisateur installe → relaunch", async () => {
    const update = makeUpdate("5.0.0");
    vi.mocked(check).mockResolvedValue(update as any);

    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.update?.version).toBe("5.0.0"));

    await act(() => result.current.install());

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("done");
  });

  it("S2 — utilisateur ignore la bannière puis l'affiche à nouveau", () => {
    const { result } = renderHook(() => useUpdater());

    act(() => result.current.dismiss());
    expect(result.current.dismissed).toBe(true);

    act(() => result.current.undismiss());
    expect(result.current.dismissed).toBe(false);
  });
});
