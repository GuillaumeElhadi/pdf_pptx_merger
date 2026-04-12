import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "./UpdateBanner";
import { makeUpdate } from "../test/helpers";

describe("UpdateBanner — visibilité", () => {
  it("n'est pas rendu quand update est null", () => {
    const { container } = render(
      <UpdateBanner update={null} status="idle" dismissed={false} onInstall={() => {}} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("n'est pas rendu quand dismissed est true", () => {
    const { container } = render(
      <UpdateBanner update={makeUpdate()} status="idle" dismissed={true} onInstall={() => {}} onDismiss={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("est rendu quand une mise à jour est disponible et non ignorée", () => {
    render(
      <UpdateBanner update={makeUpdate("4.0.0")} status="idle" dismissed={false} onInstall={() => {}} onDismiss={() => {}} />
    );
    expect(screen.getByText(/4\.0\.0/)).toBeInTheDocument();
  });
});

describe("UpdateBanner — interactions idle", () => {
  it("appelle onInstall au clic sur Mettre à jour", async () => {
    const onInstall = vi.fn();
    render(
      <UpdateBanner update={makeUpdate()} status="idle" dismissed={false} onInstall={onInstall} onDismiss={() => {}} />
    );
    await userEvent.click(screen.getByText("Mettre à jour"));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("appelle onDismiss au clic sur Plus tard", async () => {
    const onDismiss = vi.fn();
    render(
      <UpdateBanner update={makeUpdate()} status="idle" dismissed={false} onInstall={() => {}} onDismiss={onDismiss} />
    );
    await userEvent.click(screen.getByText("Plus tard"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("UpdateBanner — état downloading", () => {
  it("affiche Téléchargement… pendant le download", () => {
    render(
      <UpdateBanner update={makeUpdate()} status="downloading" dismissed={false} onInstall={() => {}} onDismiss={() => {}} />
    );
    expect(screen.getByText("Téléchargement…")).toBeInTheDocument();
  });

  it("désactive les deux boutons pendant le download", () => {
    render(
      <UpdateBanner update={makeUpdate()} status="downloading" dismissed={false} onInstall={() => {}} onDismiss={() => {}} />
    );
    expect(screen.getByText("Téléchargement…")).toBeDisabled();
    expect(screen.getByText("Plus tard")).toBeDisabled();
  });
});
