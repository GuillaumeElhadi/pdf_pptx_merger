import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractOwners } from "./ownerExtractor";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import * as pdfjsLib from "pdfjs-dist";

/** Builds a mock pdfjs TextItem at the given y position. */
function textItem(str: string, y: number) {
  return { str, transform: [1, 0, 0, 1, 0, y] };
}

/** Creates a mock pdfjs document where each element in `pages` describes one page. */
function mockDocument(pages: { width: number; height: number; items: ReturnType<typeof textItem>[] }[]) {
  const mockPages = pages.map((p) => ({
    getViewport: vi.fn(() => ({ width: p.width, height: p.height })),
    getTextContent: vi.fn(() => Promise.resolve({ items: p.items })),
  }));

  vi.mocked(pdfjsLib.getDocument).mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: vi.fn((n: number) => Promise.resolve(mockPages[n - 1])),
      destroy: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as ReturnType<typeof pdfjsLib.getDocument>);
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

describe("extractOwners — portrait PDF", () => {
  it("retourne [] sans lire les pages suivantes", async () => {
    mockDocument([{ width: 595, height: 842, items: [] }]); // A4 portrait
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([]);
  });
});

describe("extractOwners — landscape PDF, contenu vide", () => {
  it("retourne [] si aucun texte", async () => {
    mockDocument([{ width: 842, height: 595, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([]);
  });
});

describe("extractOwners — propriétaire unique", () => {
  it("détecte le code et le nom sur les lignes suivantes", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          textItem("S.A.S. IMMO. CARREFOUR", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }]);
  });

  it("code et label séparés en deux items sur la même ligne (même y)", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire ", 500),
          textItem("0000042", 500), // même y = même ligne
          textItem("SARL DUPONT IMMOBILIER", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
  });

  it("code seul sur la ligne suivante (entre label et nom)", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire", 500),
          textItem("0000099", 480),          // ligne intermédiaire avec seulement le code
          textItem("FONCIÈRE ATLANTIQUE", 460),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000099", name: "FONCIÈRE ATLANTIQUE" }]);
  });
});

describe("extractOwners — faux positifs comptables", () => {
  it("ignore une ligne de compte '450000 COPROPRIETAIRE ...' (code avant le mot-clé)", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("450000 COPROPRIETAIRE 0.00 40 006.54 450000 COPROPRIETAIRE 143 823.68 4 545.46", 352),
          textItem("40 Fournisseurs 723.60 8.04", 336),
          textItem("Total II 723.61 40 338.58", 264),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([]);
  });
});

describe("extractOwners — label présent mais incomplet", () => {
  it("retourne [] si le code est absent", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire", 500),
          textItem("Nom sans code", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([]);
  });

  it("retourne [] si le nom est absent après le code", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          // rien en dessous
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([]);
  });
});

describe("extractOwners — structure réelle avec adresse postale", () => {
  it("saute les lignes d'adresse (chiffre) entre le label et le nom", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 516),
          textItem("93 Avenue de Paris", 512),   // adresse → ignorée
          textItem("91 3 00 MASSY", 504),         // code postal → ignoré
          textItem("S.A.S. IMMO. CARREFOUR", 496),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }]);
  });

  it("supprime le suffixe 'Exercice du ...' fusionné par pdf.js sur la ligne du nom", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 516),
          textItem("93 Avenue de Paris", 512),
          textItem("91 3 00 MASSY", 504),
          textItem("S.A.S. IMMO. CARREFOUR", 496),
          textItem("Exercice du 01/01/2025 au 31/12/2025", 496), // même y, colonne droite
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" }]);
  });
});

describe("extractOwners — variantes d'accentuation", () => {
  it("accepte 'Coproprietaire' sans accent sur le 'é'", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Coproprietaire 0000007", 500),
          textItem("SCI LUMIERE", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000007", name: "SCI LUMIERE" }]);
  });
});

describe("extractOwners — plusieurs pages", () => {
  it("collecte les propriétaires distincts sur différentes pages", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          textItem("S.A.S. IMMO. CARREFOUR", 480),
        ],
      },
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000002", 500),
          textItem("SARL DUPONT", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ code: "0000001", name: "S.A.S. IMMO. CARREFOUR" });
    expect(result[1]).toEqual({ code: "0000002", name: "SARL DUPONT" });
  });

  it("déduplique un propriétaire présent sur plusieurs pages", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          textItem("S.A.S. IMMO. CARREFOUR", 480),
        ],
      },
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          textItem("S.A.S. IMMO. CARREFOUR", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toHaveLength(1);
  });

  it("ignore les pages communes (sans label Copropriétaire)", async () => {
    mockDocument([
      {
        width: 842, height: 595,
        items: [
          textItem("Page commune — relevé général", 500),
        ],
      },
      {
        width: 842, height: 595,
        items: [
          textItem("Copropriétaire 0000003", 500),
          textItem("GIE CENTRES COMMERCIAUX", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result).toEqual([{ code: "0000003", name: "GIE CENTRES COMMERCIAUX" }]);
  });
});
