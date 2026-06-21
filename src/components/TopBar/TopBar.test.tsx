import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";
import { useMergeStore } from "../../store/useMergeStore";
import { Bridge } from "../../services/bridge";
import { ThemeWrapper, resetStore, makePdf } from "../../test/helpers";

vi.mock("../../services/bridge", () => ({
  Bridge: {
    pickPptxFile: vi.fn(),
    pickPdfFiles: vi.fn(),
    convertPptx: vi.fn(),
    getPdfPageCount: vi.fn(),
    pickSaveLocation: vi.fn(),
    getGoogleDrivePath: vi.fn().mockResolvedValue(null),
    extractPdfPage: vi.fn(),
    openFile: vi.fn(),
  },
}));

// TopBar utilise useTheme — on l'enveloppe dans ThemeWrapper
function renderTopBar() {
  return render(
    <ThemeWrapper>
      <TopBar />
    </ThemeWrapper>
  );
}

beforeEach(resetStore);

describe("TopBar — état idle sans PDF", () => {
  it("affiche les boutons principaux", () => {
    renderTopBar();
    expect(screen.getByText(/Ajout PowerPoint/)).toBeInTheDocument();
    expect(screen.getByText(/Ajouter des PDFs/)).toBeInTheDocument();
    expect(screen.getByText(/Générer PDF/)).toBeInTheDocument();
  });

  it("le bouton Générer est désactivé sans PDF", () => {
    renderTopBar();
    expect(screen.getByText(/Générer PDF/)).toBeDisabled();
  });
});

describe("TopBar — état idle avec PDF", () => {
  it("le bouton Générer est actif quand un PDF est présent", () => {
    useMergeStore.setState({ items: [makePdf("a")] });
    renderTopBar();
    expect(screen.getByText(/Générer PDF/)).not.toBeDisabled();
  });
});

describe("TopBar — état converting", () => {
  beforeEach(() => useMergeStore.setState({ status: "converting" }));

  it("affiche Conversion… sur le bouton PowerPoint", () => {
    renderTopBar();
    expect(screen.getByText("Conversion…")).toBeInTheDocument();
  });

  it("tous les boutons d'action sont désactivés", () => {
    renderTopBar();
    expect(screen.getByText("Conversion…")).toBeDisabled();
    expect(screen.getByText(/Ajouter des PDFs/)).toBeDisabled();
  });
});

describe("TopBar — état merging", () => {
  beforeEach(() => useMergeStore.setState({ status: "merging", items: [makePdf("a")] }));

  it("affiche Fusion… sur le bouton Générer", () => {
    renderTopBar();
    expect(screen.getByText("Fusion…")).toBeInTheDocument();
  });

  it("tous les boutons d'action sont désactivés pendant la fusion", () => {
    renderTopBar();
    expect(screen.getByText(/Ajout PowerPoint/)).toBeDisabled();
    expect(screen.getByText(/Ajouter des PDFs/)).toBeDisabled();
    expect(screen.getByText("Fusion…")).toBeDisabled();
  });
});

describe("TopBar — interactions", () => {
  it("clic sur Ajout PowerPoint déclenche loadPptx", async () => {
    vi.mocked(Bridge.pickPptxFile).mockResolvedValue(null); // annulation
    renderTopBar();
    await userEvent.click(screen.getByText(/Ajout PowerPoint/));
    expect(Bridge.pickPptxFile).toHaveBeenCalledOnce();
  });

  it("clic sur Ajouter des PDFs déclenche addPdfs", async () => {
    vi.mocked(Bridge.pickPdfFiles).mockResolvedValue(null); // annulation
    renderTopBar();
    await userEvent.click(screen.getByText(/Ajouter des PDFs/));
    expect(Bridge.pickPdfFiles).toHaveBeenCalledOnce();
  });
});

describe("TopBar — toggles de détection", () => {
  it("affiche les deux toggles désactivés par défaut", () => {
    renderTopBar();
    expect(screen.getByLabelText(/Détecter propriétaires/)).not.toBeChecked();
    expect(screen.getByLabelText(/Corriger orientation/)).not.toBeChecked();
  });

  it("active le toggle propriétaires au clic", async () => {
    renderTopBar();
    await userEvent.click(screen.getByLabelText(/Détecter propriétaires/));
    expect(useMergeStore.getState().ownersDetectionEnabled).toBe(true);
  });

  it("active le toggle rotation au clic", async () => {
    renderTopBar();
    await userEvent.click(screen.getByLabelText(/Corriger orientation/));
    expect(useMergeStore.getState().rotationDetectionEnabled).toBe(true);
  });

  it("désactive les deux toggles pendant la conversion", () => {
    useMergeStore.setState({ status: "converting" });
    renderTopBar();
    expect(screen.getByLabelText(/Détecter propriétaires/)).toBeDisabled();
    expect(screen.getByLabelText(/Corriger orientation/)).toBeDisabled();
  });
});
