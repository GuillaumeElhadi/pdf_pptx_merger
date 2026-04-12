import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MergeList } from "./MergeList";
import { useMergeStore } from "../../store/useMergeStore";
import { resetStore, makePdf, makeSlide } from "../../test/helpers";
import { strings } from "../../strings";

// ZoomThumb utilise pdfjs-dist qui ne tourne pas dans jsdom
vi.mock("./ZoomThumb", () => ({ ZoomThumb: () => null }));

vi.mock("../../services/bridge", () => ({
  Bridge: {
    openFile: vi.fn(),
    extractPdfPage: vi.fn(),
    getGoogleDrivePath: vi.fn().mockResolvedValue(null),
  },
}));

beforeEach(resetStore);

describe("MergeList — état vide", () => {
  it("affiche le message d'état vide", () => {
    render(<MergeList />);
    expect(screen.getByText(strings.mergeList.empty)).toBeInTheDocument();
  });
});

describe("MergeList — avec items", () => {
  it("affiche une ligne par PdfItem", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/docs/rapport.pdf"), makePdf("b", "/docs/annexe.pdf")],
    });
    render(<MergeList />);
    expect(screen.getByText("rapport.pdf")).toBeInTheDocument();
    expect(screen.getByText("annexe.pdf")).toBeInTheDocument();
  });

  it("affiche le label pour chaque SlideItem", () => {
    useMergeStore.setState({
      slidePdf: "/tmp/slides.pdf",
      items: [makeSlide("s1", 0), makeSlide("s2", 2)],
    });
    render(<MergeList />);
    expect(screen.getByText(strings.slideItem.label(1))).toBeInTheDocument();
    expect(screen.getByText(strings.slideItem.label(3))).toBeInTheDocument();
  });

  it("affiche un mix de PDFs et de slides", () => {
    useMergeStore.setState({
      slidePdf: "/tmp/slides.pdf",
      items: [makePdf("a", "/docs/intro.pdf"), makeSlide("s1", 0)],
    });
    render(<MergeList />);
    expect(screen.getByText("intro.pdf")).toBeInTheDocument();
    expect(screen.getByText(strings.slideItem.label(1))).toBeInTheDocument();
  });
});

// ── Sélection toggle ──────────────────────────────────────────────────────────

describe("MergeList — sélection toggle", () => {
  it("clic sur un item l'ajoute à selectedIds", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf")] });
    render(<MergeList />);
    fireEvent.click(screen.getByText("a.pdf"));
    expect(useMergeStore.getState().selectedIds.has("a")).toBe(true);
  });

  it("second clic sur un item déjà sélectionné le retire de selectedIds", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf")],
      selectedIds: new Set(["a"]),
    });
    render(<MergeList />);
    fireEvent.click(screen.getByText("a.pdf"));
    expect(useMergeStore.getState().selectedIds.has("a")).toBe(false);
  });

  it("deux clics indépendants sélectionnent deux items distincts", async () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")],
    });
    render(<MergeList />);
    await userEvent.click(screen.getByText("a.pdf"));
    await userEvent.click(screen.getByText("b.pdf"));
    const { selectedIds } = useMergeStore.getState();
    expect(selectedIds.has("a")).toBe(true);
    expect(selectedIds.has("b")).toBe(true);
  });
});

// ── Sélection Shift+Click ─────────────────────────────────────────────────────

describe("MergeList — sélection Shift+Click", () => {
  it("Shift+Click sans clic précédent agit comme un clic normal (lastClickedIdRef nul)", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")] });
    render(<MergeList />);
    // Premier clic est un shift+click sans lastClickedIdRef → toggle
    fireEvent.click(screen.getByText("b.pdf"), { shiftKey: true });
    expect(useMergeStore.getState().selectedIds.has("b")).toBe(true);
    expect(useMergeStore.getState().selectedIds.has("a")).toBe(false);
  });

  it("Shift+Click depuis 'a' vers 'c' sélectionne toute la plage [a, b, c]", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf"), makePdf("c", "/c.pdf")],
    });
    render(<MergeList />);
    // Clic simple sur "a" → définit lastClickedIdRef
    fireEvent.click(screen.getByText("a.pdf"));
    // Shift+click sur "c" → sélectionne la plage a→c
    fireEvent.click(screen.getByText("c.pdf"), { shiftKey: true });
    const { selectedIds } = useMergeStore.getState();
    expect(selectedIds.has("a")).toBe(true);
    expect(selectedIds.has("b")).toBe(true);
    expect(selectedIds.has("c")).toBe(true);
  });

  it("Shift+Click en sens inverse (c→a) sélectionne aussi toute la plage", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf"), makePdf("c", "/c.pdf")],
    });
    render(<MergeList />);
    // Clic simple sur "c" → définit lastClickedIdRef
    fireEvent.click(screen.getByText("c.pdf"));
    // Shift+click sur "a" → sélectionne la plage c→a (même résultat grâce à min/max)
    fireEvent.click(screen.getByText("a.pdf"), { shiftKey: true });
    const { selectedIds } = useMergeStore.getState();
    expect(selectedIds.has("a")).toBe(true);
    expect(selectedIds.has("b")).toBe(true);
    expect(selectedIds.has("c")).toBe(true);
  });

  it("Shift+Click étend une sélection existante sans la réinitialiser", () => {
    // a et d déjà sélectionnés, Shift+Click sur c depuis anchor b doit inclure b→c
    useMergeStore.setState({
      items: [
        makePdf("a", "/a.pdf"),
        makePdf("b", "/b.pdf"),
        makePdf("c", "/c.pdf"),
        makePdf("d", "/d.pdf"),
      ],
      selectedIds: new Set(["a"]),
    });
    render(<MergeList />);
    // Clic simple sur "b" → définit lastClickedIdRef à "b"
    fireEvent.click(screen.getByText("b.pdf"));
    // Shift+Click sur "d" → étend depuis "b" jusqu'à "d"
    fireEvent.click(screen.getByText("d.pdf"), { shiftKey: true });
    const { selectedIds } = useMergeStore.getState();
    // "a" était déjà sélectionné et est conservé (setSelectedIds spread avec existant)
    expect(selectedIds.has("a")).toBe(true);
    expect(selectedIds.has("b")).toBe(true);
    expect(selectedIds.has("c")).toBe(true);
    expect(selectedIds.has("d")).toBe(true);
  });
});
