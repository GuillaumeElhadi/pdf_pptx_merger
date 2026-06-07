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

// Node 26+ defines localStorage as a native getter returning undefined (requires
// --localstorage-file flag). Override it with an in-memory implementation so
// tests that use bare `localStorage` work with the jsdom environment.
if (typeof localStorage === "undefined") {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});
