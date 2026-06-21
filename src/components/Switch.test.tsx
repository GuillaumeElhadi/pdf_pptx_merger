/**
 * Tests ZOMBIES pour Switch — src/components/Switch.tsx
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch — Z : non cochée", () => {
  it("affiche le label et n'est pas cochée", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).not.toBeChecked();
  });
});

describe("Switch — O : cochée", () => {
  it("affiche l'état coché", () => {
    render(<Switch checked={true} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).toBeChecked();
  });
});

describe("Switch — interactions", () => {
  it("appelle onChange(true) au clic quand non cochée", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Mon réglage" />);
    await userEvent.click(screen.getByLabelText("Mon réglage"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch — Boundaries : disabled", () => {
  it("est désactivée quand disabled=true", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" disabled />);
    expect(screen.getByLabelText("Mon réglage")).toBeDisabled();
  });

  it("n'est pas désactivée par défaut (disabled non fourni)", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Mon réglage" />);
    expect(screen.getByLabelText("Mon réglage")).not.toBeDisabled();
  });
});
