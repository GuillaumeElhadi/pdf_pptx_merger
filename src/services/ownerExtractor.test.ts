import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractOwners, normalizeName } from "./ownerExtractor";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

vi.mock("./ocrExtractor", () => ({
  ocrPage: vi.fn().mockResolvedValue(""),
  ocrPageWithAutoRotation: vi.fn().mockResolvedValue({ text: "", rotationCorrection: 0 }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import * as pdfjsLib from "pdfjs-dist";
import { ocrPage } from "./ocrExtractor";
import { ocrPageWithAutoRotation } from "./ocrExtractor";

/** Builds a mock pdfjs TextItem at the given y position. */
function textItem(str: string, y: number) {
  return { str, transform: [1, 0, 0, 1, 0, y] };
}

/** Creates a mock pdfjs document where each element in `pages` describes one page. */
function mockDocument(
  pages: { width: number; height: number; items: ReturnType<typeof textItem>[] }[]
) {
  const mockPages = pages.map((p) => ({
    getTextContent: vi.fn(() => Promise.resolve({ items: p.items })),
    getViewport: vi.fn(() => ({ width: p.width, height: p.height })),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
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

beforeEach(() => {
  vi.resetAllMocks();
  // Re-establish safe defaults so tests that don't explicitly set OCR mocks get empty results.
  vi.mocked(ocrPage).mockResolvedValue("");
  vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({ text: "", rotationCorrection: 0 });
});

describe("normalizeName", () => {
  it("strips leading S.A.S. juridical form", () => {
    expect(normalizeName("S.A.S. CARREFOUR HYPER.")).toBe("CARREFOUR HYPER");
  });

  it("strips leading S.A. juridical form", () => {
    expect(normalizeName("S.A. CONFORAMA  DEVELLOPPEMENT 12")).toBe("CONFORAMA DEVELLOPPEMENT 12");
  });

  it("strips leading S.A.R.L. juridical form", () => {
    expect(normalizeName("S.A.R.L. DUPONT IMMOBILIER")).toBe("DUPONT IMMOBILIER");
  });

  it("removes mid-word dots (abbreviations like IMMO.)", () => {
    expect(normalizeName("IMMO. CARREFOUR")).toBe("IMMO CARREFOUR");
  });

  it("removes trailing dot", () => {
    expect(normalizeName("CARREFOUR HYPER.")).toBe("CARREFOUR HYPER");
  });

  it("removes leading hyphen artifact", () => {
    expect(normalizeName("-GHESQUIERE")).toBe("GHESQUIERE");
  });

  it("removes leading hyphen and strips juridical form", () => {
    expect(normalizeName("-ELIPHI - MR MASURE")).toBe("ELIPHI - MR MASURE");
  });

  it("leaves clean names unchanged", () => {
    expect(normalizeName("MAGASINS DE RENNES")).toBe("MAGASINS DE RENNES");
  });

  it("collapses multiple internal spaces to one", () => {
    expect(normalizeName("CONFORAMA  DEVELLOPPEMENT 12")).toBe("CONFORAMA DEVELLOPPEMENT 12");
  });

  it("does not strip 4-char words that happen to end with a dot (not juridical)", () => {
    // "IMMO." has 4 chars — the pattern only matches 1–3 char components
    expect(normalizeName("S.A.S. IMMO. CARREFOUR")).toBe("IMMO CARREFOUR");
  });

  it("leaves names without dots unchanged except for trim", () => {
    expect(normalizeName("  GIE CENTRES COMMERCIAUX  ")).toBe("GIE CENTRES COMMERCIAUX");
  });
});

describe("extractOwners — portrait PDF sans pattern propriétaire", () => {
  it("retourne owners=[] et pageOwners vide si aucun contenu trouvé", async () => {
    mockDocument([{ width: 595, height: 842, items: [] }]); // A4 portrait, no owner text
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
    expect(result.pageOwners.size).toBe(0);
  });
});

describe("extractOwners — landscape PDF, contenu vide", () => {
  it("retourne owners=[] et pageOwners vide si aucun texte", async () => {
    mockDocument([{ width: 842, height: 595, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
    expect(result.pageOwners.size).toBe(0);
  });
});

describe("extractOwners — propriétaire unique", () => {
  it("détecte le code et le nom sur les lignes suivantes", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
    expect(result.pageOwners.get(1)).toEqual({ code: "0000001", name: "IMMO CARREFOUR" });
  });

  it("code et label séparés en deux items sur la même ligne (même y)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Copropriétaire ", 500),
          textItem("0000042", 500), // même y = même ligne
          textItem("SARL DUPONT IMMOBILIER", 480),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
    expect(result.pageOwners.get(1)?.code).toBe("0000042");
  });

  it("code seul sur la ligne suivante (entre label et nom)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Copropriétaire", 500),
          textItem("0000099", 480), // ligne intermédiaire avec seulement le code
          textItem("FONCIÈRE ATLANTIQUE", 460),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000099", name: "FONCIÈRE ATLANTIQUE" }]);
    expect(result.pageOwners.get(1)?.code).toBe("0000099");
  });
});

describe("extractOwners — faux positifs comptables", () => {
  it("ignore une ligne de compte '450000 COPROPRIETAIRE ...' (code avant le mot-clé)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem(
            "450000 COPROPRIETAIRE 0.00 40 006.54 450000 COPROPRIETAIRE 143 823.68 4 545.46",
            352
          ),
          textItem("40 Fournisseurs 723.60 8.04", 336),
          textItem("Total II 723.61 40 338.58", 264),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
    expect(result.pageOwners.size).toBe(0);
  });
});

describe("extractOwners — label présent mais incomplet", () => {
  it("retourne owners=[] si le code est absent", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire", 500), textItem("Nom sans code", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("retourne owners=[] si le nom est absent après le code", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          // rien en dessous
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });
});

describe("extractOwners — structure réelle avec adresse postale", () => {
  it("saute les lignes d'adresse (chiffre) entre le label et le nom", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Copropriétaire 0000001", 516),
          textItem("93 Avenue de Paris", 512), // adresse → ignorée
          textItem("91 3 00 MASSY", 504), // code postal → ignoré
          textItem("S.A.S. IMMO. CARREFOUR", 496),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
    expect(result.pageOwners.get(1)?.code).toBe("0000001");
  });

  it("supprime le suffixe 'Exercice du ...' fusionné par pdf.js sur la ligne du nom", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
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
    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
  });
});

describe("extractOwners — variantes d'accentuation", () => {
  it("accepte 'Coproprietaire' sans accent sur le 'é'", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Coproprietaire 0000007", 500), textItem("SCI LUMIERE", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000007", name: "SCI LUMIERE" }]);
  });
});

describe("extractOwners — plusieurs pages", () => {
  it("collecte les propriétaires distincts sur différentes pages", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000002", 500), textItem("SARL DUPONT", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.owners[0]).toEqual({ code: "0000001", name: "IMMO CARREFOUR" });
    expect(result.owners[1]).toEqual({ code: "0000002", name: "SARL DUPONT" });
  });

  it("déduplique un propriétaire présent sur plusieurs pages", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(1);
  });

  it("ignore les pages communes (sans label Copropriétaire)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Page commune — relevé général", 500)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000003", 500), textItem("GIE CENTRES COMMERCIAUX", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "0000003", name: "GIE CENTRES COMMERCIAUX" }]);
  });
});

describe("extractOwners — pageOwners : attribution par page", () => {
  it("page orpheline (pas de label) est absente de pageOwners", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Page commune — relevé général", 500)], // pas de Copropriétaire
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageOwners.has(1)).toBe(false); // page orpheline
    expect(result.pageOwners.get(2)?.code).toBe("0000001");
  });

  it("deux pages pour deux owners distincts → attribution correcte", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000002", 500), textItem("OWNER B", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageOwners.get(1)?.code).toBe("0000001");
    expect(result.pageOwners.get(2)?.code).toBe("0000002");
  });

  it("utilise l'objet canonique de found (même référence pour pages dupliquées)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    // Both pages point to the same OwnerInfo object
    expect(result.pageOwners.get(1)).toBe(result.pageOwners.get(2));
    expect(result.pageOwners.get(1)).toBe(result.owners[0]);
  });
});

describe("extractOwners — document mixte (première page portrait)", () => {
  it("détecte les propriétaires sur les pages suivantes même si la page 1 est portrait", async () => {
    mockDocument([
      { width: 595, height: 842, items: [] }, // page 1: portrait cover, no owner
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      }, // page 2: landscape with owner
      {
        width: 595,
        height: 842,
        items: [textItem("Copropriétaire 0000002", 500), textItem("SARL DUPONT", 480)],
      }, // page 3: portrait with second owner
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.owners[0]).toEqual({ code: "0000001", name: "IMMO CARREFOUR" });
    expect(result.owners[1]).toEqual({ code: "0000002", name: "SARL DUPONT" });
    expect(result.pageOwners.has(1)).toBe(false); // page 1: no owner found
    expect(result.pageOwners.get(2)?.code).toBe("0000001");
    expect(result.pageOwners.get(3)?.code).toBe("0000002");
  });
});

describe("extractOwners — carry-forward : pages sans label héritent du dernier owner", () => {
  it("page de contenu sans label hérite du propriétaire de la page précédente", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Tableau de répartition des charges", 500)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000002", 500), textItem("OWNER B", 480)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Tableau de répartition des charges", 500)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.pageOwners.get(1)?.code).toBe("0000001");
    expect(result.pageOwners.get(2)?.code).toBe("0000001");
    expect(result.pageOwners.get(3)?.code).toBe("0000002");
    expect(result.pageOwners.get(4)?.code).toBe("0000002");
  });

  it("page avant tout owner reste orpheline (absente de pageOwners)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Rapport annuel 2025", 500)],
      },
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageOwners.has(1)).toBe(false);
    expect(result.pageOwners.get(2)?.code).toBe("0000001");
  });
});

describe("extractOwners — fallback OCR (page sans texte)", () => {
  it("appelle ocrPageWithAutoRotation quand une page n'a aucun item texte", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
  });

  it("n'appelle pas ocrPage('full') si ocrPageWithAutoRotation a trouvé un propriétaire", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledTimes(1);
    expect(ocrPage).not.toHaveBeenCalled();
  });

  it("escalade vers ocrPage('full', rotationCorrection) si le crop ne trouve pas de propriétaire", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Texte sans propriétaire dans le bandeau",
      rotationCorrection: 90,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce("Copropriétaire 0000042\nSARL DUPONT IMMOBILIER");
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(Function)
    );
    expect(ocrPage).toHaveBeenNthCalledWith(1, expect.anything(), "full", 90);
    expect(result.owners).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
  });

  it("n'appelle pas ocrPage ni ocrPageWithAutoRotation quand la page a du texte", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Copropriétaire 0000001", 500), textItem("S.A.S. IMMO. CARREFOUR", 480)],
      },
    ]);
    await extractOwners("/doc.pdf");
    expect(ocrPage).not.toHaveBeenCalled();
    expect(ocrPageWithAutoRotation).not.toHaveBeenCalled();
  });
});

describe("extractOwners — format 'Edition par Coproprietaire' (sous-titre après plage de dates)", () => {
  it("détecte le nom sur la ligne suivant 'Du XX/XX/XXXX au XX/XX/XXXX' (chemin texte)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("10189 SDC CC ST POL JARDINS", 700),
          textItem("T5 PPA CLOS EN 2025", 650),
          textItem("Du 01/01/2025 au 31/12/2025", 600),
          textItem("CARREFOUR HYPER.", 560),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "CARREFOUR HYPER", name: "CARREFOUR HYPER" }]);
    expect(result.pageOwners.get(1)?.name).toBe("CARREFOUR HYPER");
  });

  it("détecte plusieurs owners distincts sur des pages différentes", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Du 01/01/2025 au 31/12/2025", 600), textItem("CARREFOUR HYPER.", 560)],
      },
      {
        width: 595,
        height: 842,
        items: [
          textItem("Du 01/01/2025 au 31/12/2025", 600),
          textItem("CONFORAMA DEVELOPPEMENT 12", 560),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.owners[0].name).toBe("CARREFOUR HYPER");
    expect(result.owners[1].name).toBe("CONFORAMA DEVELOPPEMENT 12");
    expect(result.pageOwners.get(1)?.name).toBe("CARREFOUR HYPER");
    expect(result.pageOwners.get(2)?.name).toBe("CONFORAMA DEVELOPPEMENT 12");
  });

  it("fonctionne via OCR quand la page est scannée (pas de texte)", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Du 01/01/2025 au 31/12/2025\nCARREFOUR HYPER.",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "CARREFOUR HYPER", name: "CARREFOUR HYPER" }]);
    expect(result.pageOwners.get(1)?.name).toBe("CARREFOUR HYPER");
  });

  it("déduplique le même owner présent sur plusieurs pages (même nom = même code)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Du 01/01/2025 au 31/12/2025", 600), textItem("CARREFOUR HYPER.", 560)],
      },
      {
        width: 595,
        height: 842,
        items: [textItem("Du 01/01/2025 au 31/12/2025", 600), textItem("CARREFOUR HYPER.", 560)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(1);
    expect(result.pageOwners.get(1)).toBe(result.pageOwners.get(2));
  });

  it("ignore les lignes numériques entre la date et le nom", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("Du 01/01/2025 au 31/12/2025", 600),
          textItem("123456", 580), // ligne numérique intercalée
          textItem("ELIPHI - MR MASURE", 560),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "ELIPHI - MR MASURE", name: "ELIPHI - MR MASURE" }]);
  });
});

describe("extractOwners — pageRotationCorrections", () => {
  it("stocke la correction non-zéro dans pageRotationCorrections", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 90,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.get(1)).toBe(90);
  });

  it("n'enregistre pas une correction de 0° dans pageRotationCorrections", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.size).toBe(0);
  });

  it("pageRotationCorrections est vide pour une page avec texte normalement orienté", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections).toBeInstanceOf(Map);
    expect(result.pageRotationCorrections.size).toBe(0);
  });
});

// ── detectTextRotation — via extractOwners text path ──────────────────────────

/** Text item whose content direction is rotated by `angleDeg` degrees. */
function rotatedItem(str: string, y: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const fs = 12;
  return { str, transform: [Math.cos(rad) * fs, Math.sin(rad) * fs, 0, 0, 0, y] };
}

describe("extractOwners — rotation detection from text transforms", () => {
  it("stores correction=90 when text items are 90° CW (transform angle −90°)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          rotatedItem("Tableau des charges", 700, 270),
          rotatedItem("Exercice 2025", 680, 270),
          rotatedItem("Copropriétaire 0000001", 660, 270),
          rotatedItem("OWNER A", 640, 270),
          rotatedItem("Montant total", 620, 270),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.get(1)).toBe(90);
  });

  it("stores correction=270 when text items are 90° CCW (transform angle +90°)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          rotatedItem("Texte A", 700, 90),
          rotatedItem("Texte B", 680, 90),
          rotatedItem("Texte C", 660, 90),
          rotatedItem("Texte D", 640, 90),
          rotatedItem("Texte E", 620, 90),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.get(1)).toBe(270);
  });

  it("stores correction=180 when text items are upside down (transform angle 180°)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          rotatedItem("Ligne A", 700, 180),
          rotatedItem("Ligne B", 680, 180),
          rotatedItem("Ligne C", 660, 180),
          rotatedItem("Ligne D", 640, 180),
          rotatedItem("Ligne E", 620, 180),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.get(1)).toBe(180);
  });

  it("stores no correction for normally-oriented text (transform angle 0°)", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Copropriétaire 0000001", 500),
          textItem("OWNER A", 480),
          textItem("Charges communes", 460),
          textItem("Montant total", 440),
          textItem("Exercice 2025", 420),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.has(1)).toBe(false);
  });

  it("stores no correction when fewer than 3 non-empty items (unreliable)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [rotatedItem("Texte A", 700, 270), rotatedItem("Texte B", 680, 270)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.has(1)).toBe(false);
  });

  it("stores no correction when no single orientation reaches 50% of items", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("Normal A", 700),
          textItem("Normal B", 680),
          rotatedItem("CW A", 660, 270),
          rotatedItem("CW B", 640, 270),
          rotatedItem("CCW A", 620, 90),
          rotatedItem("CCW B", 600, 90),
        ],
      },
    ]);
    // Each angle: 2/6 = 33% — none reaches 50%
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.has(1)).toBe(false);
  });

  it("applies correction to page 2 independently of page 1", async () => {
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          textItem("Page 1 normal A", 500),
          textItem("Page 1 normal B", 480),
          textItem("Page 1 normal C", 460),
        ],
      },
      {
        width: 595,
        height: 842,
        items: [
          rotatedItem("Page 2 CW A", 700, 270),
          rotatedItem("Page 2 CW B", 680, 270),
          rotatedItem("Page 2 CW C", 660, 270),
          rotatedItem("Page 2 CW D", 640, 270),
          rotatedItem("Page 2 CW E", 620, 270),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.pageRotationCorrections.has(1)).toBe(false);
    expect(result.pageRotationCorrections.get(2)).toBe(90);
  });
});

describe("extractOwners — rotated embedded text falls back to OCR", () => {
  it("uses OCR when hasText=true but text is 90°CW-rotated and parseOwner fails", async () => {
    // Both items share y=500 → buildLines() merges them into one line → matchOwner fails.
    // transform[0]=0, transform[1]=-12 → atan2(-12,0) = -90° → bucketed to 270° →
    // correction = (360-270)%360 = 90 (90° CW rotation detected).
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 90,
    });

    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          // 3 items needed: detectTextRotation requires ≥3 to determine dominant angle reliably
          { str: "Copropriétaire 0000001", transform: [0, -12, 0, 0, 200, 500] },
          { str: "S.A.S. IMMO. CARREFOUR", transform: [0, -12, 0, 0, 150, 500] },
          { str: "Exercice 2025", transform: [0, -12, 0, 0, 100, 500] },
        ],
      },
    ]);

    const result = await extractOwners("/doc.pdf");

    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
    expect(result.pageOwners.get(1)).toEqual({ code: "0000001", name: "IMMO CARREFOUR" });
    expect(ocrPageWithAutoRotation).toHaveBeenCalledTimes(1);
    expect(ocrPage).not.toHaveBeenCalled();
    expect(result.pageRotationCorrections.get(1)).toBe(90);
  });

  it("escalates to ocrPage('full') when crop OCR also fails on rotated page", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "texte sans propriétaire",
      rotationCorrection: 90,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce("Copropriétaire 0000042\nSARL DUPONT IMMOBILIER");

    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          { str: "Copropriétaire 0000042", transform: [0, -12, 0, 0, 200, 500] },
          { str: "SARL DUPONT IMMOBILIER", transform: [0, -12, 0, 0, 150, 500] },
          { str: "Autre texte", transform: [0, -12, 0, 0, 100, 500] },
          { str: "Encore du texte", transform: [0, -12, 0, 0, 50, 500] },
        ],
      },
    ]);

    const result = await extractOwners("/doc.pdf");

    expect(result.owners).toEqual([{ code: "0000042", name: "SARL DUPONT IMMOBILIER" }]);
    expect(ocrPageWithAutoRotation).toHaveBeenCalledTimes(1);
    expect(ocrPage).toHaveBeenCalledWith(expect.anything(), "full", 90);
    expect(result.pageRotationCorrections.get(1)).toBe(90);
  });

  it("does NOT call OCR when hasText=true but parseOwner already succeeds", async () => {
    // Normally-oriented items at distinct y values → buildLines separates them → parseOwner wins.
    mockDocument([
      {
        width: 842,
        height: 595,
        items: [
          { str: "Copropriétaire 0000001", transform: [12, 0, 0, 12, 200, 500] },
          { str: "S.A.S. IMMO. CARREFOUR", transform: [12, 0, 0, 12, 150, 480] },
          { str: "Autre texte A", transform: [12, 0, 0, 12, 150, 460] },
          { str: "Autre texte B", transform: [12, 0, 0, 12, 150, 440] },
          { str: "Autre texte C", transform: [12, 0, 0, 12, 150, 420] },
        ],
      },
    ]);

    const result = await extractOwners("/doc.pdf");

    expect(result.owners).toEqual([{ code: "0000001", name: "IMMO CARREFOUR" }]);
    expect(ocrPageWithAutoRotation).not.toHaveBeenCalled();
    expect(ocrPage).not.toHaveBeenCalled();
  });

  it("hasText=true + rotation: ocrPageWithAutoRotation appelé AVEC validate (Pattern 1)", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Copropriétaire 0000001\nS.A.S. IMMO. CARREFOUR",
      rotationCorrection: 90,
    });
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          { str: "Copropriétaire 0000001", transform: [0, -12, 0, 0, 200, 500] },
          { str: "S.A.S. IMMO. CARREFOUR", transform: [0, -12, 0, 0, 150, 500] },
          { str: "Exercice 2025", transform: [0, -12, 0, 0, 100, 500] },
        ],
      },
    ]);
    await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
  });
});

describe("extractOwners — page hybride (texte partiel + contenu image)", () => {
  it("détecte le propriétaire via OCR quand du texte est embarqué mais le bloc destinataire est image", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "S.A.S. COMPANY NAME\nRéférence : A001",
      rotationCorrection: 0,
    });
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          // Management company header is embedded text, but recipient block is image
          textItem("Carrefour Property Gestion", 800),
          textItem("93 Avenue de Paris - 91300 MASSY", 790),
          textItem("Date", 300),
          textItem("Pièce", 300),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
    expect(result.pageOwners.get(1)?.name).toBe("COMPANY NAME");
  });

  it("escalade vers ocrPage('full', 0) quand le crop OCR ne trouve pas de propriétaire", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "entête sans propriétaire",
      rotationCorrection: 0,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce("S.A.S. COMPANY NAME\nRéférence : A001");
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Carrefour Property Gestion", 800)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledTimes(1);
    expect(ocrPage).toHaveBeenCalledWith(expect.anything(), "full", 0);
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
  });

  it("ne déclenche pas le fallback OCR hybride quand parseOwner réussit sur la page textuée", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Copropriétaire 0000001", 500), textItem("OWNER A", 480)],
      },
    ]);
    await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).not.toHaveBeenCalled();
    expect(ocrPage).not.toHaveBeenCalled();
  });

  it("retourne owners=[] si OCR ne trouve pas non plus de propriétaire (page sans destinataire)", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "entête management uniquement",
      rotationCorrection: 0,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce("texte comptable sans propriétaire");
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Carrefour Property Gestion", 800)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
    expect(result.pageOwners.size).toBe(0);
  });
});

describe("extractOwners — Type 2 (Edition par Coproprietaire) via OCR", () => {
  it("image-only page: détecte Pattern 2 (date + owner) via OCR crop", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "10189 SDC CC ST POL JARDINS\nT5 PPA CLOS EN 2025\nDu 01/01/2025 au 31/12/2025\nCARREFOUR HYPER.",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "CARREFOUR HYPER", name: "CARREFOUR HYPER" }]);
    expect(result.pageOwners.get(1)?.name).toBe("CARREFOUR HYPER");
  });

  it("image-only page: plusieurs pages avec owners distincts (Pattern 2)", async () => {
    vi.mocked(ocrPageWithAutoRotation)
      .mockResolvedValueOnce({
        text: "Du 01/01/2025 au 31/12/2025\nCARREFOUR HYPER.",
        rotationCorrection: 0,
      })
      .mockResolvedValueOnce({
        text: "Du 01/01/2025 au 31/12/2025\nCONFORAMA DEVELLOPPEMENT 12",
        rotationCorrection: 0,
      });
    mockDocument([
      { width: 595, height: 842, items: [] },
      { width: 595, height: 842, items: [] },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.owners[0].name).toBe("CARREFOUR HYPER");
    expect(result.owners[1].name).toBe("CONFORAMA DEVELLOPPEMENT 12");
  });

  it("image-only page: pas d'owner si aucun nom ne suit la date (document commun)", async () => {
    // Date line present but no owner name follows → all-owners document → should produce no owner
    const noOwnerText =
      "10189 SDC CC ST POL JARDINS\nT5 PPA CLOS EN 2025\nDu 01/01/2025 au 31/12/2025";
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: noOwnerText,
      rotationCorrection: 0,
    });
    vi.mocked(ocrPage).mockResolvedValueOnce(noOwnerText);
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
    expect(result.pageOwners.size).toBe(0);
  });

  it("hasText=true + rotation + Pattern 2 : ocrPageWithAutoRotation appelé avec validate", async () => {
    // Embedded text rotated 90° CW — all items share same y → buildLines merges them → matchOwner fails
    // After the gap fix, ocrPageWithAutoRotation must receive a validate callback
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "Du 01/01/2025 au 31/12/2025\nCARREFOUR HYPER.",
      rotationCorrection: 90,
    });
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          { str: "Du 01/01/2025 au 31/12/2025", transform: [0, -12, 0, 0, 200, 500] },
          { str: "CARREFOUR HYPER.", transform: [0, -12, 0, 0, 150, 500] },
          { str: "T5 PPA CLOS EN 2025", transform: [0, -12, 0, 0, 100, 500] },
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "CARREFOUR HYPER", name: "CARREFOUR HYPER" }]);
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
  });
});

describe("extractOwners — format 'Référence :' (Carrefour Property Gestion)", () => {
  it("détecte le nom sur la ligne précédant 'Référence :' (chemin texte)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("S.A.S. COMPANY NAME", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
    expect(result.pageOwners.get(1)?.name).toBe("COMPANY NAME");
  });

  it("saute les lignes d'adresse (numériques) entre le nom et 'Référence :'", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("S.A.S. COMPANY NAME", 700),
          textItem("123 Rue de la Paix", 680),
          textItem("75001 Paris", 660),
          textItem("Référence : A001", 640),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
  });

  it("normalise le préfixe juridique (S.A.S.)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("S.A.S. IMMO FRANCE", 650), textItem("Référence : X999", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "IMMO FRANCE", name: "IMMO FRANCE" }]);
  });

  it("détecte plusieurs owners distincts sur des pages différentes", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("S.A.S. ALPHA RETAIL", 650), textItem("Référence : A001", 630)],
      },
      {
        width: 595,
        height: 842,
        items: [textItem("SARL DUPONT NORD", 650), textItem("Référence : B002", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(2);
    expect(result.owners[0].name).toBe("ALPHA RETAIL");
    expect(result.owners[1].name).toBe("SARL DUPONT NORD");
    expect(result.pageOwners.get(1)?.name).toBe("ALPHA RETAIL");
    expect(result.pageOwners.get(2)?.name).toBe("SARL DUPONT NORD");
  });

  it("ignore les champs libellés (contenant ':') entre le nom et 'Référence :'", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("S.A.S. COMPANY NAME", 720),
          textItem("Arrêté : 31/12/2025", 700), // labeled field — must be skipped
          textItem("Référence : A001", 680),
        ],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
  });

  it("retourne owners=[] si aucun nom valide ne précède 'Référence :' (seulement champs libellés)", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Arrêté : 31/12/2025", 700), textItem("Référence : A001", 680)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("déduplique le même owner sur plusieurs pages", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("S.A.S. COMPANY NAME", 650), textItem("Référence : A001", 630)],
      },
      {
        width: 595,
        height: 842,
        items: [textItem("S.A.S. COMPANY NAME", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toHaveLength(1);
    expect(result.pageOwners.get(1)).toBe(result.pageOwners.get(2));
  });

  it("fonctionne via OCR quand la page est scannée", async () => {
    vi.mocked(ocrPageWithAutoRotation).mockResolvedValue({
      text: "S.A.S. COMPANY NAME\nRéférence : A001",
      rotationCorrection: 0,
    });
    mockDocument([{ width: 595, height: 842, items: [] }]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([{ code: "COMPANY NAME", name: "COMPANY NAME" }]);
  });
});

describe("extractOwners — Pattern 3 : validation du nom candidat", () => {
  it("rejette les noms en minuscules (artefacts OCR comme 'gestior')", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("gestior", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("rejette les noms en casse mixte (comme 'Carrefour Property Gestion 8')", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("Carrefour Property Gestion 8", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("rejette les noms contenant '/' (artefacts de pagination comme 's/11')", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("s/11", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("rejette les noms terminant par une lettre isolée (titres tronqués comme 'RELEVE PROVISOIRE D')", async () => {
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [textItem("RELEVE PROVISOIRE D", 650), textItem("Référence : A001", 630)],
      },
    ]);
    const result = await extractOwners("/doc.pdf");
    expect(result.owners).toEqual([]);
  });

  it("appelle ocrPageWithAutoRotation en fallback sur page textuée quand parseOwner échoue", async () => {
    // hasText=true (items non vides) mais parseOwner ne trouve rien → fallback OCR hybride
    mockDocument([
      {
        width: 595,
        height: 842,
        items: [
          textItem("Carrefour Property Gestion", 800),
          textItem("93 Avenue de Paris - 91300 MASSY", 790),
        ],
      },
    ]);
    await extractOwners("/doc.pdf");
    expect(ocrPageWithAutoRotation).toHaveBeenCalledWith(expect.anything(), expect.any(Function));
  });
});
