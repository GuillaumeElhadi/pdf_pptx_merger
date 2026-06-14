import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OwnerBanner } from "./OwnerBanner";
import { useMergeStore } from "../store/useMergeStore";
import { resetStore, makePdf } from "../test/helpers";
import type { OwnerInfo } from "../types";

function owner(code: string, name: string): OwnerInfo {
  return { code, name };
}

beforeEach(resetStore);

describe("OwnerBanner — aucun propriétaire", () => {
  it("ne s'affiche pas quand la liste est vide", () => {
    const { container } = render(<OwnerBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("ne s'affiche pas quand les PDFs n'ont pas encore été analysés (owners undefined)", () => {
    useMergeStore.setState({ items: [makePdf("a"), makePdf("b")] });
    const { container } = render(<OwnerBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("ne s'affiche pas quand tous les PDFs sont portrait (owners vide)", () => {
    useMergeStore.setState({
      items: [
        { ...makePdf("a"), owners: [] },
        { ...makePdf("b"), owners: [] },
      ],
    });
    const { container } = render(<OwnerBanner />);
    expect(container.firstChild).toBeNull();
  });
});

describe("OwnerBanner — propriétaire unique", () => {
  it("affiche le nom du propriétaire avec le préfixe 'Copropriétaire'", () => {
    useMergeStore.setState({
      items: [{ ...makePdf("a"), owners: [owner("0000001", "IMMO CARREFOUR")] }],
    });
    render(<OwnerBanner />);
    expect(screen.getByText(/Copropriétaire/)).toBeInTheDocument();
    expect(screen.getByText(/IMMO CARREFOUR/)).toBeInTheDocument();
  });

  it("affiche l'icône ✓ pour un seul propriétaire", () => {
    useMergeStore.setState({
      items: [{ ...makePdf("a"), owners: [owner("0000001", "SARL DUPONT")] }],
    });
    render(<OwnerBanner />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });
});

describe("OwnerBanner — plusieurs propriétaires", () => {
  it("déduplique un même propriétaire présent dans plusieurs PDFs", () => {
    useMergeStore.setState({
      items: [
        { ...makePdf("a"), owners: [owner("0000001", "IMMO CARREFOUR")] },
        { ...makePdf("b"), owners: [owner("0000001", "IMMO CARREFOUR")] },
      ],
    });
    render(<OwnerBanner />);
    // Un seul nom doit apparaître
    const matches = screen.getAllByText(/IMMO CARREFOUR/);
    expect(matches).toHaveLength(1);
    // Pas d'alerte — un seul propriétaire unique
    expect(screen.queryByText("⚠")).toBeNull();
  });

  it("affiche l'icône ⚠ et le compte quand plusieurs propriétaires distincts", () => {
    useMergeStore.setState({
      items: [
        { ...makePdf("a"), owners: [owner("0000001", "IMMO CARREFOUR")] },
        { ...makePdf("b"), owners: [owner("0000002", "SARL DUPONT")] },
      ],
    });
    render(<OwnerBanner />);
    expect(screen.getByText("⚠")).toBeInTheDocument();
    expect(screen.getByText(/2 copropriétaires/)).toBeInTheDocument();
    expect(screen.getByText(/IMMO CARREFOUR/)).toBeInTheDocument();
    expect(screen.getByText(/SARL DUPONT/)).toBeInTheDocument();
  });

  it("déduplique par nom quand deux PDFs ont des codes différents pour le même propriétaire", () => {
    // Pattern 1 (PRREPC): numeric code — Pattern 2 (EDITION): name as code
    useMergeStore.setState({
      items: [
        { ...makePdf("a"), owners: [owner("0000001", "IMMO CARREFOUR")] },
        { ...makePdf("b"), owners: [owner("IMMO CARREFOUR", "IMMO CARREFOUR")] },
      ],
    });
    render(<OwnerBanner />);
    expect(screen.getAllByText(/IMMO CARREFOUR/)).toHaveLength(1);
    expect(screen.queryByText("⚠")).toBeNull();
  });

  it("affiche chaque nom dans un élément séparé accessible individuellement", () => {
    useMergeStore.setState({
      items: [
        {
          ...makePdf("a"),
          owners: [owner("0000001", "IMMO CARREFOUR"), owner("0000002", "SARL DUPONT")],
        },
      ],
    });
    render(<OwnerBanner />);
    expect(screen.getByText("IMMO CARREFOUR")).toBeInTheDocument();
    expect(screen.getByText("SARL DUPONT")).toBeInTheDocument();
  });

  it("est développé par défaut — tous les noms visibles sans interaction", () => {
    useMergeStore.setState({
      items: [
        {
          ...makePdf("a"),
          owners: [owner("0000001", "IMMO CARREFOUR"), owner("0000002", "SARL DUPONT")],
        },
      ],
    });
    render(<OwnerBanner />);
    expect(screen.getByText("IMMO CARREFOUR")).toBeInTheDocument();
    expect(screen.getByText("SARL DUPONT")).toBeInTheDocument();
  });

  it("masque la liste des noms quand on clique sur le bouton de réduction", async () => {
    useMergeStore.setState({
      items: [
        {
          ...makePdf("a"),
          owners: [owner("0000001", "IMMO CARREFOUR"), owner("0000002", "SARL DUPONT")],
        },
      ],
    });
    render(<OwnerBanner />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("IMMO CARREFOUR")).not.toBeInTheDocument();
    expect(screen.queryByText("SARL DUPONT")).not.toBeInTheDocument();
  });

  it("réaffiche les noms quand on clique à nouveau sur le bouton", async () => {
    useMergeStore.setState({
      items: [
        {
          ...makePdf("a"),
          owners: [owner("0000001", "IMMO CARREFOUR"), owner("0000002", "SARL DUPONT")],
        },
      ],
    });
    render(<OwnerBanner />);
    const btn = screen.getByRole("button");
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(screen.getByText("IMMO CARREFOUR")).toBeInTheDocument();
    expect(screen.getByText("SARL DUPONT")).toBeInTheDocument();
  });

  it("ignore les PDFs sans owners lors du calcul de la liste", () => {
    useMergeStore.setState({
      items: [
        { ...makePdf("a"), owners: [owner("0000001", "IMMO CARREFOUR")] },
        makePdf("b"), // owners undefined
        { ...makePdf("c"), owners: [] }, // PDF portrait
      ],
    });
    render(<OwnerBanner />);
    // Un seul propriétaire trouvé — pas de ⚠
    expect(screen.queryByText("⚠")).toBeNull();
    expect(screen.getByText(/Copropriétaire/)).toBeInTheDocument();
  });
});
