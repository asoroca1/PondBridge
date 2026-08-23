import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EventComposer from "./EventComposer.jsx";

function render(props = {}) {
  return renderToStaticMarkup(
    <EventComposer
      open
      type="seminar"
      onClose={() => {}}
      onSave={() => {}}
      request={async () => ({ items: [] })}
      {...props}
    />
  );
}

describe("choosing whether an info session has a date", () => {
  test("offers no date at all as an explicit choice", () => {
    const markup = render();
    expect(markup).toContain("No date yet");
    expect(markup).toContain("Pick a date");
  });

  test("starts a new session on a date, since most sessions have one", () => {
    const markup = render();
    // The chosen option is the one marked selected for screen readers.
    const pickADate = markup.slice(markup.indexOf("Pick a date") - 220, markup.indexOf("Pick a date"));
    expect(pickADate).toContain('aria-checked="true"');
    expect(markup).toContain("Starts");
    expect(markup).toContain("Ends");
  });

  test("remembers that an existing undated session has no date", () => {
    const markup = render({ event: { eventType: "seminar", title: "Wake Forest", startsAt: null } });
    const noDateYet = markup.slice(markup.indexOf("No date yet") - 220, markup.indexOf("No date yet"));
    expect(noDateYet).toContain('aria-checked="true"');
    // The date inputs give way to an explanation of what undated means.
    expect(markup).toContain("Date coming soon");
  });

  test("keeps a scheduled session scheduled when reopened for editing", () => {
    const markup = render({
      event: { eventType: "seminar", title: "Wake Forest", startsAt: "2026-08-18T17:00:00.000Z" }
    });
    const pickADate = markup.slice(markup.indexOf("Pick a date") - 220, markup.indexOf("Pick a date"));
    expect(pickADate).toContain('aria-checked="true"');
  });

  test("never offers an undated community event, which still needs a date", () => {
    const markup = render({ type: "community" });
    expect(markup).not.toContain("No date yet");
    expect(markup).toContain("Starts");
  });

  test("no longer calls the topic headline the thing that blocks publishing", () => {
    // The dropdown is the topic; the headline stays optional, and the server
    // now agrees.
    expect(render()).toContain("Topic headline");
  });
});
