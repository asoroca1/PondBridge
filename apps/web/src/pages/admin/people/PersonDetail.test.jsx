import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PersonDetail from "./PersonDetail.jsx";

function detail(requiresConsent, stage = "request") {
  const markup = renderToStaticMarkup(<PersonDetail
    person={{ stage, requestId: "synthetic-request", email: "verified@example.test", firstName: "Test", requiresConsent }}
    slug="greenlane" actions={{ busy: "" }}
  />);
  const document = new DOMParser().parseFromString(markup, "text/html");
  return { document, approve: [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Approve") };
}

test("a recovered request permits a director decision while explaining the separate access requirement", () => {
  const { document, approve } = detail(true);
  expect(document.body.textContent).toContain("Email verified.");
  expect(document.body.textContent).toContain("before they gain access");
  expect(document.body.textContent).toContain("will not need to approve them again");
  expect(approve.disabled).toBe(false);
});

test("a saved approval awaiting setup cannot be approved twice and can be withdrawn", () => {
  const { document, approve } = detail(true, "awaiting_setup");
  expect(approve).toBeUndefined();
  expect(document.body.textContent).toContain("Your approval is saved");
  expect(document.body.textContent).toContain("No further approval is needed");
  expect([...document.querySelectorAll("button")].some((button) => button.textContent.includes("Withdraw approval"))).toBe(true);
});

test("a request with completed consent retains the normal approval action", () => {
  const { document, approve } = detail(false);
  expect(approve.disabled).toBe(false);
  expect(document.body.textContent).not.toContain("still needs to confirm");
});
