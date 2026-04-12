/**
 * Tests ZOMBIES pour logger — src/utils/logger.ts
 *
 * Logique testée :
 *  - fmt()         : format "[context] msg"
 *  - logger.action : info() appelé, avec et sans details
 *  - logger.info   : info() appelé avec le bon format
 *  - logger.warn   : warn() appelé
 *  - logger.error  : logError() appelé, extraction du message Error vs string
 *  - Fallback      : si le plugin Tauri rejette → console.* appelé
 *
 * Note sur l'async : les méthodes du logger appellent info/warn/error de façon
 * synchrone (l'appel lui-même est immédiat). Les assertions sur le plugin n'ont
 * pas besoin d'await. En revanche, le fallback console.* s'exécute dans le .catch()
 * (microtask), ce qui nécessite un tick d'attente via `await Promise.resolve()`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { info, warn, error as logError } from "@tauri-apps/plugin-log";
import { logger } from "./logger";

// ── Mock @tauri-apps/plugin-log ───────────────────────────────────────────────

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Z — Zero : action sans détails ───────────────────────────────────────────

describe("logger — Z : action sans details", () => {
  it("logger.action(name) appelle info avec '[ACTION] name'", () => {
    logger.action("loadPptx");
    expect(vi.mocked(info)).toHaveBeenCalledWith("[ACTION] loadPptx");
  });
});

// ── O — One : chaque méthode ──────────────────────────────────────────────────

describe("logger — O : méthodes de base", () => {
  it("logger.info(context, msg) appelle info avec '[context] msg'", () => {
    logger.info("generate", "PDF saved");
    expect(vi.mocked(info)).toHaveBeenCalledWith("[generate] PDF saved");
  });

  it("logger.warn(context, msg) appelle warn avec '[context] msg'", () => {
    logger.warn("splitter", "page count 0");
    expect(vi.mocked(warn)).toHaveBeenCalledWith("[splitter] page count 0");
  });

  it("logger.error(context, Error) extrait le .message", () => {
    logger.error("loadPptx", new Error("PowerPoint introuvable"));
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      "[loadPptx] PowerPoint introuvable"
    );
  });
});

// ── M — Many : action avec details ───────────────────────────────────────────

describe("logger — M : action avec details", () => {
  it("logger.action(name, details) inclut le JSON des details", () => {
    logger.action("addPdfs", { count: 3, files: ["a.pdf"] });
    expect(vi.mocked(info)).toHaveBeenCalledWith(
      '[ACTION] addPdfs — {"count":3,"files":["a.pdf"]}'
    );
  });

  it("logger.action(name, {}) inclut un objet vide JSON", () => {
    logger.action("clearError", {});
    expect(vi.mocked(info)).toHaveBeenCalledWith("[ACTION] clearError — {}");
  });
});

// ── B — Boundaries : types d'erreur ──────────────────────────────────────────

describe("logger — B : types d'erreur", () => {
  it("logger.error avec un string utilise String(err)", () => {
    logger.error("generate", "Disk full");
    expect(vi.mocked(logError)).toHaveBeenCalledWith("[generate] Disk full");
  });

  it("logger.error avec un nombre utilise String(err)", () => {
    logger.error("bridge", 404);
    expect(vi.mocked(logError)).toHaveBeenCalledWith("[bridge] 404");
  });

  it("logger.error avec Error utilise .message (pas le full stack)", () => {
    const err = new Error("message only");
    logger.error("test", err);
    const call = vi.mocked(logError).mock.calls[0][0] as string;
    expect(call).toBe("[test] message only");
    expect(call).not.toContain("Error:");
  });
});

// ── I — Interface : format du message ────────────────────────────────────────

describe("logger — I : format [context] msg", () => {
  it("le format est exactement '[context] msg' (crochets, espace, pas de séparateur extra)", () => {
    logger.info("MyModule", "hello");
    expect(vi.mocked(info)).toHaveBeenCalledWith("[MyModule] hello");
  });

  it("le contexte ACTION est en majuscules pour logger.action", () => {
    logger.action("test");
    const call = vi.mocked(info).mock.calls[0][0] as string;
    expect(call.startsWith("[ACTION]")).toBe(true);
  });
});

// ── E — Exceptions : fallback console ────────────────────────────────────────
// Le fallback s'exécute dans .catch() — microtask → await Promise.resolve() nécessaire

describe("logger — E : fallback console quand Tauri rejette", () => {
  it("info() → console.info si le plugin rejette", async () => {
    vi.mocked(info).mockRejectedValueOnce(new Error("Tauri non disponible"));
    logger.info("test", "message");
    await Promise.resolve();
    expect(console.info).toHaveBeenCalledWith("[test] message");
  });

  it("warn() → console.warn si le plugin rejette", async () => {
    vi.mocked(warn).mockRejectedValueOnce(new Error("Tauri non disponible"));
    logger.warn("test", "avertissement");
    await Promise.resolve();
    expect(console.warn).toHaveBeenCalledWith("[test] avertissement");
  });

  it("error() → console.error si le plugin rejette", async () => {
    vi.mocked(logError).mockRejectedValueOnce(new Error("Tauri non disponible"));
    logger.error("test", new Error("crash"));
    await Promise.resolve();
    expect(console.error).toHaveBeenCalledWith("[test] crash");
  });

  it("action() → console.info si le plugin rejette", async () => {
    vi.mocked(info).mockRejectedValueOnce(new Error("Tauri non disponible"));
    logger.action("loadPptx", { path: "/deck.pptx" });
    await Promise.resolve();
    expect(console.info).toHaveBeenCalledWith(
      '[ACTION] loadPptx — {"path":"/deck.pptx"}'
    );
  });
});
