/**
 * Tests ZOMBIES pour SettingsDialog — src/components/SettingsDialog.tsx
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDialog } from "./SettingsDialog";
import { useMergeStore } from "../store/useMergeStore";
import { resetStore } from "../test/helpers";

beforeEach(() => {
  resetStore();
  // Only override hardwareConcurrency — replacing the whole `navigator` object (e.g. via
  // vi.stubGlobal) would strip properties userEvent relies on internally (e.g. userAgent).
  Object.defineProperty(navigator, "hardwareConcurrency", { value: 8, configurable: true });
});

describe("SettingsDialog — Z : état par défaut", () => {
  it("affiche les deux toggles non cochés", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Détecter propriétaires/)).not.toBeChecked();
    expect(screen.getByLabelText(/Corriger orientation/)).not.toBeChecked();
  });

  it("affiche le slider de performance sur 'Équilibré' par défaut", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    // input[type=range] expose toujours sa value DOM en string (comportement natif, indépendant de jsdom) ;
    // jest-dom (même en v6.9.1, la dernière disponible) ne caste en Number que pour type=number, pas type=range.
    expect(screen.getByLabelText("Niveau de performance")).toHaveValue("1"); // index 1 = balanced
  });

  it("affiche la légende avec le nombre de workers résolu (balanced, 8 coeurs → 4)", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByText(/4 workers \(8 cœurs détectés/)).toBeInTheDocument();
  });
});

describe("SettingsDialog — interactions : toggles", () => {
  it("active le toggle propriétaires au clic", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/Détecter propriétaires/));
    expect(useMergeStore.getState().ownersDetectionEnabled).toBe(true);
  });

  it("active le toggle rotation au clic", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/Corriger orientation/));
    expect(useMergeStore.getState().rotationDetectionEnabled).toBe(true);
  });

  it("désactive les deux toggles pendant un traitement en cours", () => {
    useMergeStore.setState({ status: "extracting", pdfPendingCount: 1 });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Détecter propriétaires/)).toBeDisabled();
    expect(screen.getByLabelText(/Corriger orientation/)).toBeDisabled();
  });
});

describe("SettingsDialog — interactions : niveau de performance", () => {
  it("déplacer le slider à 'Performance' (index 2) appelle setPerformanceLevel('performance')", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const slider = screen.getByLabelText("Niveau de performance");
    fireEventChange(slider, "2");
    expect(useMergeStore.getState().performanceLevel).toBe("performance");
  });

  it("met à jour la légende après changement de niveau", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const slider = screen.getByLabelText("Niveau de performance");
    fireEventChange(slider, "0"); // economical → 1 worker
    expect(screen.getByText(/1 worker \(8 cœurs détectés/)).toBeInTheDocument();
  });
});

describe("SettingsDialog — fermeture", () => {
  it("appelle onClose au clic sur le bouton Fermer", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByText("Fermer"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// fireEvent.change est utilisé directement (au lieu de userEvent) car les input range
// ne sont pas bien supportés par userEvent.type/click pour des changements de valeur discrets.
function fireEventChange(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}
