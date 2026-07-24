import { resumeProfileSchema } from "@pondbridge/shared";
import {
  detectProfilePdfDocumentType,
  getResumeParserDisclosure,
  heuristicParseProfileDocument,
  parseProfilePdfTextToProfile
} from "../src/utils/resume.js";

const LINKEDIN_TEXT = `Contact
www.linkedin.com/in/jordan-camper
Top Skills
Community Building
Jordan Camper
Healthcare Leader
Boston, MA
Summary
I build strong communities and healthcare teams.
Experience
North Camp Health
Director
January 2022 - Present
Education
Boston University`;

describe("LinkedIn and resume PDF profile extraction", () => {
  test("detects LinkedIn Save-to-PDF structure", () => {
    expect(detectProfilePdfDocumentType(LINKEDIN_TEXT, "auto")).toBe("linkedin");
    expect(detectProfilePdfDocumentType("Jordan Camper\nExperience\nPondBridge", "auto")).toBe("resume");
  });

  test("extracts useful LinkedIn fields locally without inventing missing data", () => {
    const profile = heuristicParseProfileDocument(LINKEDIN_TEXT, "linkedin");
    expect(resumeProfileSchema.parse(profile)).toMatchObject({
      firstName: "Jordan",
      lastName: "Camper",
      cityState: "Boston, MA",
      bio: "I build strong communities and healthcare teams.",
      colleges: ["Boston University"],
      currentJobs: [{ company: "North Camp Health", role: "Director" }],
      industry: "",
      socials: { linkedin: "https://www.linkedin.com/in/jordan-camper" }
    });
  });

  test("discloses no file/text retention and review-before-save", () => {
    expect(getResumeParserDisclosure({ parserEngine: "openai" })).toMatchObject({
      provider: "openai",
      sendsExtractedTextToThirdParty: true,
      storesUploadedFile: false,
      storesExtractedText: false,
      storesUsageHashesOnly: true,
      memberReviewRequired: true,
      accountEmailProtected: true
    });
    expect(getResumeParserDisclosure({ parserEngine: "heuristic" })).toMatchObject({
      provider: "local",
      sendsExtractedTextToThirdParty: false
    });
  });

  test("returns an explicitly degraded local result when the provider is unavailable", async () => {
    const result = await parseProfilePdfTextToProfile(LINKEDIN_TEXT, {
      documentType: "linkedin",
      context: {
        tenantId: "tenant-test",
        actorUserId: "user-test",
        requestId: "request-test"
      }
    });

    expect(result).toMatchObject({
      documentType: "linkedin",
      parserEngine: "heuristic",
      generationId: null,
      usage: null,
      degraded: true,
      profile: {
        firstName: "Jordan",
        lastName: "Camper"
      }
    });
  });
});
