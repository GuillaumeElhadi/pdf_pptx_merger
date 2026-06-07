import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";

// Node.js 26 declares localStorage/sessionStorage as undefined globals (the feature
// requires --localstorage-file to be usable). This causes vitest's jsdom env to skip
// injecting jsdom's working implementation because the key already exists in globalThis.
// Stub both with in-memory implementations so tests that rely on Web Storage work correctly.
const makeStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
  };
};
vi.stubGlobal("localStorage", makeStorage());
vi.stubGlobal("sessionStorage", makeStorage());

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
