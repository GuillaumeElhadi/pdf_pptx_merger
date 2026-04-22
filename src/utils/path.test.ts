/**
 * Tests ZOMBIES pour basename() — src/utils/path.ts
 *
 * Fonction pure : pas de mock nécessaire.
 * Risque principal : chemins Windows (backslash) vs Unix (slash) et cas limites.
 */

import { describe, it, expect } from "vitest";
import { basename } from "./path";

// ── Z — Zero ──────────────────────────────────────────────────────────────────

describe("basename — Z : chaîne vide", () => {
  it("retourne une chaîne vide pour une entrée vide", () => {
    expect(basename("")).toBe("");
  });
});

// ── O — One : un seul segment ─────────────────────────────────────────────────

describe("basename — O : nom de fichier seul", () => {
  it("retourne le nom intact s'il n'y a pas de séparateur", () => {
    expect(basename("file.pdf")).toBe("file.pdf");
  });

  it("fonctionne sans extension", () => {
    expect(basename("rapport")).toBe("rapport");
  });
});

// ── M — Many : plusieurs segments ────────────────────────────────────────────

describe("basename — M : chemin multi-segments", () => {
  it("extrait le nom depuis un chemin Unix standard", () => {
    expect(basename("/home/user/docs/rapport.pdf")).toBe("rapport.pdf");
  });

  it("extrait le nom depuis un chemin Windows avec backslash", () => {
    expect(basename("C:\\Users\\Name\\Documents\\file.pdf")).toBe("file.pdf");
  });

  it("extrait le nom depuis un chemin mixte slash/backslash", () => {
    expect(basename("C:/Users/Name\\file.pdf")).toBe("file.pdf");
  });

  it("fonctionne avec un chemin Windows UNC", () => {
    expect(basename("\\\\server\\share\\file.pdf")).toBe("file.pdf");
  });
});

// ── B — Boundaries : cas limites ─────────────────────────────────────────────

describe("basename — B : limites", () => {
  it("retourne vide pour un slash racine '/'", () => {
    // split("/") → ["", ""] → pop() → "" → "" (pas null/undefined, ?? non déclenché)
    expect(basename("/")).toBe("");
  });

  it("retourne vide pour un slash de fin (chemin répertoire)", () => {
    expect(basename("/home/user/")).toBe("");
  });

  it("fonctionne avec un seul répertoire Unix", () => {
    expect(basename("/docs/file.pdf")).toBe("file.pdf");
  });

  it("fonctionne avec un seul répertoire Windows", () => {
    expect(basename("C:\\file.pdf")).toBe("file.pdf");
  });
});

// ── I — Interface : contrat entrée/sortie ─────────────────────────────────────

describe("basename — I : contrat", () => {
  it("retourne toujours une string", () => {
    expect(typeof basename("/a/b/c.pdf")).toBe("string");
  });

  it("n'altère pas le nom de fichier (casse, caractères spéciaux)", () => {
    expect(basename("/path/Rapport Annuel (2024).pdf")).toBe("Rapport Annuel (2024).pdf");
  });

  it("préserve les extensions multiples", () => {
    expect(basename("/path/archive.tar.gz")).toBe("archive.tar.gz");
  });
});
