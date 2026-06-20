import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ZoomThumb } from "./ZoomThumb";

vi.mock("../../hooks/useThumbnail", () => ({
  useThumbnail: () => ({ url: "blob:fake-thumb", loading: false }),
}));
vi.mock("./MergeList", () => ({ useDragActive: () => false }));

const ZOOM_W = 800;
const ZOOM_H = 600;
const PADDING = 12; // 6px padding each side

function renderAndHover(rotation: 0 | 90 | 180 | 270, rectTop: number, rectBottom: number) {
  const { container } = render(
    <ZoomThumb pdfPath="/docs/x.pdf" pageIndex={0} alt="x" rotation={rotation} />
  );
  const wrap = container.querySelector("div") as HTMLDivElement;
  wrap.getBoundingClientRect = () =>
    ({
      top: rectTop,
      bottom: rectBottom,
      left: 100,
      right: 148,
      width: 48,
      height: 36,
    }) as DOMRect;

  fireEvent.mouseEnter(wrap);

  const images = Array.from(document.body.querySelectorAll('img[alt="x"]'));
  const portalImg = images.find((img) => !container.contains(img));
  return portalImg?.parentElement as HTMLDivElement;
}

describe("ZoomThumb — positionnement de la preview", () => {
  it("reste entièrement visible verticalement pour une rotation de 90° quand la ligne est basse dans l'écran", () => {
    window.innerHeight = 900;
    window.innerWidth = 1200;
    // Row sitting low on screen: only 80px of room below it before the window edge.
    const rectTop = 820;
    const rectBottom = 856;

    const overlay = renderAndHover(90, rectTop, rectBottom);
    expect(overlay).toBeTruthy();

    const top = parseFloat(overlay.style.top);
    // For a 90°/270° rotation the rendered box is ZOOM_W tall (swapped dimensions).
    const actualBoxHeight = ZOOM_W + PADDING;
    expect(top + actualBoxHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("reste entièrement visible verticalement pour une rotation de 0°", () => {
    window.innerHeight = 900;
    window.innerWidth = 1200;
    const rectTop = 650;
    const rectBottom = 686;

    const overlay = renderAndHover(0, rectTop, rectBottom);
    const top = parseFloat(overlay.style.top);
    const actualBoxHeight = ZOOM_H + PADDING;
    expect(top + actualBoxHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(top).toBeGreaterThanOrEqual(8);
  });
});
