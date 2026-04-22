/**
 * Tests du câblage drag-and-drop dans MergeList.
 *
 * DndContext est mocké pour exposer les callbacks (onDragStart/End/Cancel)
 * et les déclencher de façon contrôlée. Ces tests vérifient les effets sur
 * le store (reorderItems, clearSelection), pas le comportement interne de
 * dnd-kit (sensors, collision detection).
 *
 * Ce que ces tests NE peuvent PAS couvrir :
 *   - Le choix du sensor (PointerSensor vs MouseSensor) — requiert un vrai browser
 *   - La précision des coordonnées dans un scroll container — idem
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MergeList } from "./MergeList";
import { useMergeStore } from "../../store/useMergeStore";
import { resetStore, makePdf } from "../../test/helpers";

vi.mock("./ZoomThumb", () => ({ ZoomThumb: () => null }));
vi.mock("../../services/bridge", () => ({
  Bridge: {
    openFile: vi.fn(),
    extractPdfPage: vi.fn(),
    getGoogleDrivePath: vi.fn().mockResolvedValue(null),
  },
}));

// ── Capture des callbacks DndContext ──────────────────────────────────────────

type DragEndFn = (activeId: string, overId: string | null) => void;
type DragStartFn = (activeId: string) => void;
type DragCancelFn = () => void;

let fireDragEnd: DragEndFn | undefined;
let fireDragStart: DragStartFn | undefined;
let fireDragCancel: DragCancelFn | undefined;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...mod,
    DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }: any) => {
      fireDragStart = (activeId) =>
        onDragStart?.({ active: { id: activeId, data: { current: {} } }, activatorEvent: null });
      fireDragEnd = (activeId, overId) =>
        onDragEnd?.({
          active: { id: activeId, data: { current: {} } },
          over: overId != null ? { id: overId, data: { current: {} } } : null,
          delta: { x: 0, y: 0 },
          activatorEvent: null,
          collisions: [],
        });
      fireDragCancel = () => onDragCancel?.();
      return <>{children}</>;
    },
  };
});

// useSortable retourne des valeurs neutres (pas de contexte DndContext fourni)
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...mod,
    SortableContext: ({ children }: any) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

beforeEach(() => {
  resetStore();
  fireDragEnd = undefined;
  fireDragStart = undefined;
  fireDragCancel = undefined;
});

// ── Réordonnancement ──────────────────────────────────────────────────────────

describe("MergeList — drag-and-drop : réordonnancement", () => {
  it("drag end inverse deux items (A→B place A après B)", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")] });
    render(<MergeList />);

    act(() => fireDragEnd!("a", "b"));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["b", "a"]);
  });

  it("drag end ne modifie pas l'ordre si active === over", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")] });
    render(<MergeList />);

    act(() => fireDragEnd!("a", "a"));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("drag end ne modifie pas l'ordre si over est null (drop annulé)", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")] });
    render(<MergeList />);

    act(() => fireDragEnd!("a", null));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("drag end réinitialise selectedIds", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")],
      selectedIds: new Set(["a", "b"]),
    });
    render(<MergeList />);

    act(() => fireDragEnd!("a", "b"));

    expect(useMergeStore.getState().selectedIds.size).toBe(0);
  });

  it("drag cancel ne modifie pas la liste", () => {
    useMergeStore.setState({ items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf")] });
    render(<MergeList />);

    act(() => fireDragStart!("a"));
    act(() => fireDragCancel!());

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["a", "b"]);
  });
});

// ── Multi-sélection ───────────────────────────────────────────────────────────

describe("MergeList — drag-and-drop : multi-sélection", () => {
  it("drag end déplace le groupe sélectionné ensemble vers la cible", () => {
    // items=[a,b,c], sélection={a,b}, drag a→c (vers le bas)
    // others=[c], overInOthers=0, draggingDown=true → pos=1
    // résultat attendu : [c, a, b]
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf"), makePdf("c", "/c.pdf")],
      selectedIds: new Set(["a", "b"]),
    });
    render(<MergeList />);

    act(() => fireDragEnd!("a", "c"));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["c", "a", "b"]);
  });

  it("drag end avec sélection d'un seul item agit comme un déplacement simple", () => {
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf"), makePdf("c", "/c.pdf")],
      selectedIds: new Set(["a"]),
    });
    render(<MergeList />);

    act(() => fireDragEnd!("a", "c"));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["b", "c", "a"]);
  });

  it("drag end d'un item hors sélection ignore la sélection", () => {
    // a et b sélectionnés, mais on drag c (hors sélection) → déplacement simple de c
    useMergeStore.setState({
      items: [makePdf("a", "/a.pdf"), makePdf("b", "/b.pdf"), makePdf("c", "/c.pdf")],
      selectedIds: new Set(["a", "b"]),
    });
    render(<MergeList />);

    act(() => fireDragEnd!("c", "a"));

    const ids = useMergeStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(["c", "a", "b"]);
  });
});
