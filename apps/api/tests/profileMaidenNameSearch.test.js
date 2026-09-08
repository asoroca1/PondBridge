import { __testables } from "../src/db/models/ProfileModel.js";

const { scoreProfileForQuery, profileSearchFields } = __testables;

const casey = {
  firstName: "Casey",
  lastName: "Director",
  socials: { nickname: "Case", maidenName: "Whitfield" }
};

const noMaidenName = {
  firstName: "Casey",
  lastName: "Oyelaran",
  socials: {}
};

describe("maiden name in member search", () => {
  it("keeps the maiden name out of fullName, which the exact-match bonus reads", () => {
    // Appending it would stop "casey director" being an exact fullName hit and
    // quietly demote every member who has a maiden name on file.
    expect(profileSearchFields(casey).fullName).toBe("casey case director");
    expect(profileSearchFields(casey).maidenName).toBe("whitfield");
    expect(profileSearchFields(casey).maidenFullName).toBe("casey whitfield");
  });

  it("leaves the fields untouched for a member with no maiden name", () => {
    const fields = profileSearchFields(noMaidenName);
    expect(fields.maidenName).toBe("");
    expect(fields.maidenFullName).toBe("");
  });

  it("finds someone by the name their camp friends remember", () => {
    expect(scoreProfileForQuery(casey, "Whitfield").keep).toBe(true);
    expect(scoreProfileForQuery(casey, "Casey Whitfield").keep).toBe(true);
  });

  it("ranks the maiden-name match above a same-first-name member who is not one", () => {
    const hit = scoreProfileForQuery(casey, "Casey Whitfield");
    const miss = scoreProfileForQuery(noMaidenName, "Casey Whitfield");
    expect(hit.score).toBeGreaterThan(miss.score);
  });

  it("does not change the score of a search for the name as it reads", () => {
    // The guarantee that matters: adding a maiden name must not move a member
    // in the results for their own current name. maidenFullName is a separate
    // haystack precisely so this holds.
    const withMaidenName = scoreProfileForQuery(casey, "Casey Director");
    const without = scoreProfileForQuery(
      { firstName: "Casey", lastName: "Director", socials: { nickname: "Case" } },
      "Casey Director"
    );
    expect(withMaidenName.score).toBe(without.score);
  });

  it("does not outrank the member whose current name is the query", () => {
    const yara = { firstName: "Yara", lastName: "Whitfield", socials: {} };
    const exact = scoreProfileForQuery(yara, "Yara Whitfield");
    const viaMaidenName = scoreProfileForQuery(casey, "Yara Whitfield");
    expect(exact.score).toBeGreaterThan(viaMaidenName.score);
  });
});
