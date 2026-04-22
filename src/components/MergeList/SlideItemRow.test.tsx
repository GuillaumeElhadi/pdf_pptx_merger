import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideItemRow } from "./SlideItemRow";
import { useMergeStore } from "../../store/useMergeStore";
import { DndWrapper, resetStore, makeSlide } from "../../test/helpers";
import { strings } from "../../strings";

vi.mock("./ZoomThumb", () => ({ ZoomThumb: () => null }));
vi.mock("../../services/bridge", () => ({
  Bridge: { openFile: vi.fn(), extractPdfPage: vi.fn() },
}));

function renderRow(slideIndex = 0, selected = false) {
  const item = makeSlide("s", slideIndex);
  return render(
    <DndWrapper ids={["s"]}>
      <SlideItemRow item={item} selected={selected} onSelect={() => {}} isGroupFollower={false} />
    </DndWrapper>
  );
}

beforeEach(() => {
  resetStore();
  useMergeStore.setState({ slidePdf: "/tmp/slides.pdf" });
});

describe("SlideItemRow — rendu", () => {
  it("affiche le label de la diapositive (1-based)", () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    renderRow(0);
    expect(screen.getByText(strings.slideItem.label(1))).toBeInTheDocument();
  });

  it("affiche le bon numéro pour les diapositives suivantes", () => {
    useMergeStore.setState({ items: [makeSlide("s", 4)] });
    renderRow(4);
    expect(screen.getByText(strings.slideItem.label(5))).toBeInTheDocument();
  });

  it("n'affiche pas le badge de rotation quand rotation = 0", () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    renderRow(0);
    expect(screen.queryByText(/°/)).toBeNull();
  });

  it("affiche le badge de rotation quand rotation ≠ 0", () => {
    const item = { ...makeSlide("s", 0), rotation: 180 as const };
    useMergeStore.setState({ items: [item] });
    render(
      <DndWrapper ids={["s"]}>
        <SlideItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
      </DndWrapper>
    );
    expect(screen.getByText("180°")).toBeInTheDocument();
  });
});

describe("SlideItemRow — interactions", () => {
  it("le bouton ✕ supprime la diapositive du store", async () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    renderRow(0);
    await userEvent.click(screen.getByText("✕"));
    expect(useMergeStore.getState().items).toHaveLength(0);
  });

  it("pointerdown sur ✕ ne remonte pas au parent React (empêche le déclenchement du drag)", () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    const parentSpy = vi.fn();
    const item = makeSlide("s", 0);
    const { getByText } = render(
      <DndWrapper ids={["s"]}>
        <div onPointerDown={parentSpy}>
          <SlideItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
        </div>
      </DndWrapper>
    );
    fireEvent.pointerDown(getByText("✕"));
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("pointerdown sur ↻ ne remonte pas au parent React (empêche le déclenchement du drag)", () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    const parentSpy = vi.fn();
    const item = makeSlide("s", 0);
    const { getByText } = render(
      <DndWrapper ids={["s"]}>
        <div onPointerDown={parentSpy}>
          <SlideItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
        </div>
      </DndWrapper>
    );
    fireEvent.pointerDown(getByText("↻"));
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("le bouton ↻ applique une rotation de +90°", async () => {
    useMergeStore.setState({ items: [makeSlide("s", 0)] });
    renderRow(0);
    await userEvent.click(screen.getByText("↻"));
    expect(useMergeStore.getState().items[0].rotation).toBe(90);
  });
});
