import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PdfItemRow } from "./PdfItemRow";
import { useMergeStore } from "../../store/useMergeStore";
import { DndWrapper, resetStore, makePdf } from "../../test/helpers";

vi.mock("./ZoomThumb", () => ({ ZoomThumb: () => null }));
vi.mock("../../services/bridge", () => ({
  Bridge: { openFile: vi.fn(), getGoogleDrivePath: vi.fn() },
}));

function renderRow(overrides: Partial<Parameters<typeof PdfItemRow>[0]> = {}) {
  const item = makePdf("x", "/docs/rapport.pdf");
  return render(
    <DndWrapper ids={["x"]}>
      <PdfItemRow
        item={item}
        selected={false}
        onSelect={() => {}}
        isGroupFollower={false}
        {...overrides}
      />
    </DndWrapper>
  );
}

beforeEach(resetStore);

describe("PdfItemRow — rendu", () => {
  it("affiche le nom du fichier", () => {
    renderRow();
    expect(screen.getByText("rapport.pdf")).toBeInTheDocument();
  });

  it("n'affiche pas le badge de rotation quand rotation = 0", () => {
    renderRow();
    expect(screen.queryByText(/°/)).toBeNull();
  });

  it("affiche le badge de rotation quand rotation ≠ 0", () => {
    const item = { ...makePdf("x", "/docs/rapport.pdf"), rotation: 90 as const };
    render(
      <DndWrapper ids={["x"]}>
        <PdfItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
      </DndWrapper>
    );
    expect(screen.getByText("90°")).toBeInTheDocument();
  });
});

describe("PdfItemRow — interactions", () => {
  it("le bouton ✕ supprime l'item du store", async () => {
    useMergeStore.setState({ items: [makePdf("x", "/docs/rapport.pdf")] });
    renderRow();
    await userEvent.click(screen.getByText("✕"));
    expect(useMergeStore.getState().items).toHaveLength(0);
  });

  it("le bouton ↻ applique une rotation de +90°", async () => {
    useMergeStore.setState({ items: [makePdf("x", "/docs/rapport.pdf")] });
    renderRow();
    await userEvent.click(screen.getByText("↻"));
    expect(useMergeStore.getState().items[0].rotation).toBe(90);
  });

  it("pointerdown sur ✕ ne remonte pas au parent React (empêche le déclenchement du drag)", () => {
    const parentSpy = vi.fn();
    const item = makePdf("x", "/docs/rapport.pdf");
    const { getByText } = render(
      <DndWrapper ids={["x"]}>
        <div onPointerDown={parentSpy}>
          <PdfItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
        </div>
      </DndWrapper>
    );
    fireEvent.pointerDown(getByText("✕"));
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("pointerdown sur ↻ ne remonte pas au parent React (empêche le déclenchement du drag)", () => {
    const parentSpy = vi.fn();
    const item = makePdf("x", "/docs/rapport.pdf");
    const { getByText } = render(
      <DndWrapper ids={["x"]}>
        <div onPointerDown={parentSpy}>
          <PdfItemRow item={item} selected={false} onSelect={() => {}} isGroupFollower={false} />
        </div>
      </DndWrapper>
    );
    fireEvent.pointerDown(getByText("↻"));
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it("le bouton ↻ tourne tous les items sélectionnés", async () => {
    const items = [makePdf("x", "/docs/rapport.pdf"), makePdf("y", "/docs/annexe.pdf")];
    useMergeStore.setState({ items, selectedIds: new Set(["x", "y"]) });
    render(
      <DndWrapper ids={["x", "y"]}>
        <PdfItemRow item={items[0]} selected={true} onSelect={() => {}} isGroupFollower={false} />
      </DndWrapper>
    );
    await userEvent.click(screen.getByText("↻"));
    const { items: updated } = useMergeStore.getState();
    expect(updated[0].rotation).toBe(90);
    expect(updated[1].rotation).toBe(90);
  });
});
