import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";

// Tauri n'existe pas dans jsdom — on mock tous les modules natifs
// pour que les imports dans le store ne cassent pas au chargement.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("3.8.0"),
}));

afterEach(() => {
  vi.clearAllMocks();
});
