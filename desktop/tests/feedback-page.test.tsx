import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FeedbackPage from "@/app/feedback/page";

describe("FeedbackPage", () => {
  it("builds a structured bug report that can be copied", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<FeedbackPage />);
    await user.type(screen.getByLabelText("Titre"), "La map disparaît");
    await user.type(screen.getByLabelText("Ce qui s’est passé"), "Retour depuis le rapport sans map.");
    await user.type(screen.getByLabelText("Étapes pour reproduire"), "Ouvrir le rapport puis revenir.");
    await user.click(screen.getByRole("button", { name: "Copier le rapport" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("La map disparaît"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("## Étapes pour reproduire"));
    expect(screen.getByRole("button", { name: "Rapport copié" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuer sur GitHub" })).toBeInTheDocument();
  });
});
