import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBar } from "./StatusBar";
import { useMergeStore } from "../store/useMergeStore";
import { resetStore, makeUpdate } from "../test/helpers";

beforeEach(resetStore);

describe("StatusBar — version badge", () => {
  it("affiche la version courante", () => {
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("v3.8.0")).toBeInTheDocument();
  });

  it("badge désactivé quand à jour", () => {
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("v3.8.0").closest("button")).toBeDisabled();
  });

  it("badge cliquable quand une mise à jour est disponible", async () => {
    const onUpdateClick = vi.fn();
    render(
      <StatusBar update={makeUpdate()} currentVersion="3.8.0" onUpdateClick={onUpdateClick} />
    );
    await userEvent.click(screen.getByText("v3.8.0"));
    expect(onUpdateClick).toHaveBeenCalledOnce();
  });
});

describe("StatusBar — état idle", () => {
  it("affiche le message de statut", () => {
    useMergeStore.setState({ statusMessage: "Prêt." });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("Prêt.")).toBeInTheDocument();
  });

  it("n'affiche pas de barre de progression", () => {
    useMergeStore.setState({ progress: null });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    // Le progressTrack (height: 2px) ne doit pas exister dans le DOM
    expect(container.querySelector("[style*='height: 2px']")).toBeNull();
  });
});

describe("StatusBar — état error", () => {
  it("affiche le bouton Ignorer", () => {
    useMergeStore.setState({ status: "error", statusMessage: "Quelque chose a planté" });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("Ignorer")).toBeInTheDocument();
    expect(screen.getByText("Quelque chose a planté")).toBeInTheDocument();
  });

  it("Ignorer appelle clearError et repasse à idle", async () => {
    useMergeStore.setState({ status: "error", statusMessage: "Erreur" });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    await userEvent.click(screen.getByText("Ignorer"));
    expect(useMergeStore.getState().status).toBe("idle");
  });
});

describe("StatusBar — état converting", () => {
  it("affiche le spinner et le message", () => {
    useMergeStore.setState({ status: "converting", statusMessage: "Conversion du PowerPoint en cours…" });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("⏳")).toBeInTheDocument();
    expect(screen.getByText("Conversion du PowerPoint en cours…")).toBeInTheDocument();
  });

  it("n'affiche pas la barre de progression (conversion indéterminée)", () => {
    useMergeStore.setState({ status: "converting", progress: null });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    expect(container.querySelector("[style*='height: 2px']")).toBeNull();
  });
});

describe("StatusBar — état merging avec progression", () => {
  it("affiche le spinner et le message de fusion", () => {
    useMergeStore.setState({
      status: "merging",
      statusMessage: "Fusion… 5/10 pages",
      progress: 0.5,
    });
    render(<StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />);
    expect(screen.getByText("⏳")).toBeInTheDocument();
    expect(screen.getByText("Fusion… 5/10 pages")).toBeInTheDocument();
  });

  it("affiche la barre de progression à la bonne largeur", () => {
    useMergeStore.setState({ status: "merging", progress: 0.75, statusMessage: "" });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    const fill = container.querySelector("[style*='75%']");
    expect(fill).toBeInTheDocument();
  });

  it("affiche la barre à 0% en début de fusion", () => {
    useMergeStore.setState({ status: "merging", progress: 0, statusMessage: "" });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    const fill = container.querySelector("[style*='0%']");
    expect(fill).toBeInTheDocument();
  });

  it("affiche la barre à 100% en fin de fusion", () => {
    useMergeStore.setState({ status: "merging", progress: 1, statusMessage: "" });
    const { container } = render(
      <StatusBar update={null} currentVersion="3.8.0" onUpdateClick={() => {}} />
    );
    const fill = container.querySelector("[style*='100%']");
    expect(fill).toBeInTheDocument();
  });
});
