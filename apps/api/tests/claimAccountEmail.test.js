import { describe, expect, test } from "@jest/globals";
import { claimAccountTemplate, inviteTemplate } from "../src/services/emailTemplates.js";
import { buildPeopleDirectory } from "../src/services/alumniGrowth.js";

const rendered = claimAccountTemplate({
  tenantName: "Camp Cedar",
  link: "https://cedar.example.com/login?email=dana%40example.com",
  firstName: "Dana",
  lastName: "Reyes",
  questionnaireName: "the 2026 alumni questionnaire"
});

describe("claimAccountTemplate", () => {
  // Not an invitation. Nobody is being asked whether to join — something already
  // exists with their information in it, and the subject has to say so.
  test("says the profile exists rather than inviting them to make one", () => {
    expect(rendered.subject).toBe("Your Camp Cedar alumni profile is ready");
    expect(rendered.subject).not.toMatch(/invit/i);
    expect(rendered.html).not.toMatch(/You're Invited/i);
  });

  // Unexplained mail carrying someone's job history reads as a breach. Naming the
  // questionnaire is what makes it legible to a person who answered it months ago.
  test("names where the information came from", () => {
    expect(rendered.html).toContain("the 2026 alumni questionnaire");
    expect(rendered.text).toContain("the 2026 alumni questionnaire");
  });

  test("falls back to a plain description when the camp did not name it", () => {
    const plain = claimAccountTemplate({ tenantName: "Camp Cedar", link: "https://x.test" });
    expect(plain.html).toContain("the alumni questionnaire");
  });

  test("asks for one thing: a password", () => {
    expect(rendered.html).toContain("Set Your Password");
    expect(rendered.text).toContain("Set your password:");
  });

  // The sentence that stops the support email, and it has to come before the
  // button rather than after it.
  test("promises they can change it, and that nobody sees it first", () => {
    const beforeButton = rendered.html.split("Set Your Password")[0];
    expect(beforeButton).toMatch(/change or remove anything/i);
    expect(beforeButton).toMatch(/nobody else can\s+see it/i);
  });

  test("greets someone whose name the questionnaire never captured", () => {
    const anon = claimAccountTemplate({ tenantName: "Camp Cedar", link: "https://x.test" });
    expect(anon.html).toContain("there");
    expect(anon.text).toContain("Hi there,");
  });

  test("escapes a camp name that contains markup", () => {
    const nasty = claimAccountTemplate({ tenantName: "<script>x</script>", link: "https://x.test" });
    expect(nasty.html).not.toContain("<script>x</script>");
  });

  test("carries a plain-text alternative, like every other template", () => {
    expect(rendered.text.length).toBeGreaterThan(50);
    expect(rendered.text).not.toContain("<");
    expect(inviteTemplate({ tenantName: "Camp Cedar", link: "https://x.test" }).text.length)
      .toBeGreaterThan(0);
  });
});

describe("the unclaimed stage", () => {
  const users = [
    { _id: "u1", email: "claimed@example.com", status: "active" },
    { _id: "u2", email: "waiting@example.com", status: "active" }
  ];
  const profiles = [
    { _id: "p1", userId: "u1", firstName: "Ada", status: "active" },
    { _id: "p2", userId: "u2", firstName: "Bo", status: "pending" }
  ];

  function stageOf(email) {
    const { people } = buildPeopleDirectory({ users, profiles });
    return people.find((person) => person.email === email)?.stage;
  }

  // An unclaimed account has never been signed in to and its profile is invisible
  // to the camp. Filing it under "member" would inflate the count and hide the
  // people who still need asking. Staging data proved these are not always
  // imports — its seed carries pending profiles of its own — so the stage is
  // named for the claim state rather than the provenance.
  test("an account nobody has claimed is not a member", () => {
    expect(stageOf("waiting@example.com")).toBe("unclaimed");
    expect(stageOf("claimed@example.com")).toBe("member");
  });

  test("it becomes a member once the profile is claimed", () => {
    const { people } = buildPeopleDirectory({
      users,
      profiles: profiles.map((profile) => ({ ...profile, status: "active" }))
    });
    expect(people.every((person) => person.stage === "member")).toBe(true);
  });

  test("both still appear in the directory, so a director can see who is waiting", () => {
    const { people } = buildPeopleDirectory({ users, profiles });
    expect(people).toHaveLength(2);
  });
});
