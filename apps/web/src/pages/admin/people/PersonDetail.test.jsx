import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PersonDetail from "./PersonDetail.jsx";

function detail(requiresConsent) {
  const markup = renderToStaticMarkup(<PersonDetail
    person={{ stage: "request", requestId: "synthetic-request", email: "verified@example.test", firstName: "Test", requiresConsent }}
    slug="greenlane" actions={{ busy: "" }}
  />);
  const document = new DOMParser().parseFromString(markup, "text/html");
  return { document, approve: [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Approve") };
}

test("a recovered request tells the director what is missing and prevents premature approval", () => {
  const { document, approve } = detail(true);
  expect(document.body.textContent).toContain("Email verified.");
  expect(document.body.textContent).toContain("signing in again");
  expect(approve.disabled).toBe(true);
});

test("a request with completed consent retains the normal approval action", () => {
  const { document, approve } = detail(false);
  expect(approve.disabled).toBe(false);
  expect(document.body.textContent).not.toContain("still needs to confirm");
});
