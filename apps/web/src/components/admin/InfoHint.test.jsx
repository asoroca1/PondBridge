import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoHint } from "./AdminUi.jsx";

/**
 * The ⓘ exists so that settings rows can be one line instead of a paragraph.
 * That only works if the explanation is genuinely reachable — by mouse and by
 * keyboard — and if it gets out of the way again without trapping anyone.
 */

afterEach(cleanup);

describe("InfoHint", () => {
  it("keeps its explanation hidden until asked", () => {
    render(<InfoHint label="Advanced Search">Search members by name.</InfoHint>);
    expect(screen.queryByText("Search members by name.")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("names what it is about, so the button is not just an icon to a screen reader", () => {
    render(<InfoHint label="Advanced Search">Anything.</InfoHint>);
    expect(screen.getByRole("button", { name: "About Advanced Search" })).toBeInTheDocument();
  });

  it("opens on click", async () => {
    const user = userEvent.setup();
    render(<InfoHint label="Giving">Camp general fund.</InfoHint>);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Camp general fund.")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and hands focus back to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoHint label="Giving">
          Camp general fund. <a href="/preview">Preview in network</a>
        </InfoHint>
      </div>
    );
    const trigger = screen.getByRole("button", { name: "About Giving" });
    await user.click(trigger);

    // Focus has to be somewhere else for the return to be observable at all —
    // asserting it straight after the click passes whether or not the component
    // moves focus, because the click already left it on the trigger.
    screen.getByRole("link", { name: "Preview in network" }).focus();
    expect(trigger).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByText(/Camp general fund/)).not.toBeInTheDocument();
    // Otherwise the close leaves focus on a removed node and keyboard users are
    // dropped back to the top of the document.
    expect(trigger).toHaveFocus();
  });

  it("closes when the click lands somewhere else", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoHint label="Giving">Camp general fund.</InfoHint>
        <button type="button">Elsewhere</button>
      </div>
    );
    await user.click(screen.getByRole("button", { name: "About Giving" }));
    expect(screen.getByText("Camp general fund.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByText("Camp general fund.")).not.toBeInTheDocument();
  });

  it("only lets one explanation stand open at a time", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoHint label="Directory">About the directory.</InfoHint>
        <InfoHint label="Giving">About giving.</InfoHint>
      </div>
    );
    // Opened from the keyboard on purpose. A mouse click on the second trigger
    // lands outside the first hint, so the click-away handler would close it
    // regardless — that path cannot tell whether the components coordinate.
    // Keyboard activation dispatches no pointer event, so only the shared
    // registry can close the first one.
    screen.getByRole("button", { name: "About Directory" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("About the directory.")).toBeInTheDocument();

    screen.getByRole("button", { name: "About Giving" }).focus();
    await user.keyboard("{Enter}");
    // Two open at once overlap each other on a dense list of rows.
    expect(screen.queryByText("About the directory.")).not.toBeInTheDocument();
    expect(screen.getByText("About giving.")).toBeInTheDocument();
  });
});
