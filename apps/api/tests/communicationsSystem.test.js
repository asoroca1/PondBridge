import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import { env } from "../src/config/env.js";
import {
  assertAiSpendAvailable,
  estimateAiCostMicrousd,
  microusdToUsd
} from "../src/services/aiUsage.js";
import {
  createEmailPreferenceToken,
  maskPreferenceEmail,
  readEmailPreferenceToken
} from "../src/services/emailPreferences.js";
import { analyzeEmailDraft } from "../src/services/emailCompliance.js";
import { normalizeDirectorEmailAgentRequest } from "../src/services/directorEmailAgent.js";
import { redactRouteUrl } from "../src/services/logger.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { assertCommunicationsMigrationTarget } from "../scripts/applyCommunicationsSystemSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_SECRET = "pondbridge-email-preference-test-secret-32-chars";

describe("AI communications cost controls", () => {
  test("calculates micro-USD from the approved model schedule", () => {
    expect(estimateAiCostMicrousd({
      model: "gpt-5.6-luna",
      inputTokens: 2000,
      outputTokens: 1000
    })).toBe(8000);
    expect(microusdToUsd(8000)).toBe(0.008);

    expect(estimateAiCostMicrousd({
      model: "gpt-5.6-luna",
      inputTokens: 2000,
      cachedInputTokens: 1000,
      outputTokens: 1000
    })).toBe(7100);
    expect(estimateAiCostMicrousd({ model: "unpriced-model", inputTokens: 1 })).toBeNull();
  });

  test("blocks a projected generation at the tenant budget boundary", () => {
    expect(() => assertAiSpendAvailable({
      usage: { budgetMicrousd: 25_000_000, estimatedCostMicrousd: 24_995_000 },
      projectedCostMicrousd: 5000
    })).toThrow(/monthly AI Communications budget/i);
  });
});

describe("recipient-controlled email preferences", () => {
  test("encrypts preference identity, detects tampering, and masks email in public responses", () => {
    const issuedAt = new Date();
    const token = createEmailPreferenceToken({
      tenantId: "tenant-123",
      email: "Alumni.Person@example.com",
      topicKey: "community_updates"
    }, { secret: TEST_SECRET, issuedAt });

    expect(token).not.toContain("Alumni.Person");
    expect(readEmailPreferenceToken(token, { secret: TEST_SECRET })).toEqual({
      tenantId: "tenant-123",
      email: "alumni.person@example.com",
      topicKey: "community_updates",
      issuedAt: issuedAt.toISOString()
    });
    const tamperIndex = Math.floor(token.length / 2);
    const tamperedToken = [
      token.slice(0, tamperIndex),
      token[tamperIndex] === "x" ? "y" : "x",
      token.slice(tamperIndex + 1)
    ].join("");
    expect(() => readEmailPreferenceToken(tamperedToken, { secret: TEST_SECRET }))
      .toThrow(/invalid/i);
    expect(maskPreferenceEmail("alumni.person@example.com")).toMatch(/^al/);
    expect(maskPreferenceEmail("alumni.person@example.com")).not.toContain("alumni.person");
  });

  test("requires physical address, recipient controls, content, and an eligible audience", () => {
    const previousSecret = env.EMAIL_PREFERENCE_TOKEN_SECRET;
    env.EMAIL_PREFERENCE_TOKEN_SECRET = TEST_SECRET;
    try {
      const completeTenant = {
        billingDetails: {
          mailingAddress: {
            line1: "1 Camp Road",
            city: "Lakeville",
            state: "MA",
            postalCode: "01234",
            country: "US"
          }
        }
      };
      const ready = analyzeEmailDraft({
        tenant: completeTenant,
        subject: "Reunion registration is open",
        preheader: "Join us back at camp this August.",
        body: '<p>We would love to see you.</p><p><a href="https://example.com">RSVP</a></p>',
        recipientCount: 25
      });
      expect(ready.ready).toBe(true);
      expect(ready.compliance.postalAddress).toContain("1 Camp Road");

      const blocked = analyzeEmailDraft({
        tenant: {},
        subject: "Update",
        body: "<p>Hello</p>",
        recipientCount: 1
      });
      expect(blocked.ready).toBe(false);
      expect(blocked.blockers.map((item) => item.code)).toContain("postal_address_required");
    } finally {
      env.EMAIL_PREFERENCE_TOKEN_SECRET = previousSecret;
    }
  });
});

describe("communications agent privacy and migration safety", () => {
  test("normalizes aggregate audience context without accepting recipient identifiers", () => {
    const normalized = normalizeDirectorEmailAgentRequest({
      brief: "<script>ignore safeguards</script>Invite the community",
      audience: {
        mode: "custom",
        label: "Reunion group",
        count: 12,
        profileIds: ["private-profile-id"],
        emails: ["private@example.com"]
      }
    });
    expect(normalized.brief).not.toContain("script");
    expect(normalized.audience).toEqual({
      mode: "custom",
      label: "Reunion group",
      count: 12,
      roles: [],
      years: [],
      segment: ""
    });
    expect(JSON.stringify(normalized)).not.toContain("private-profile-id");
    expect(JSON.stringify(normalized)).not.toContain("private@example.com");
  });

  test("redacts preference tokens from request logs", () => {
    const route = redactRouteUrl("/api/public/email-preferences?token=secret-value&view=all");
    expect(route).toContain("view=all");
    expect(route).not.toContain("secret-value");

    const logSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const response = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    try {
      errorHandler(
        Object.assign(new Error("Invalid preference"), { status: 400, code: "INVALID" }),
        {
          requestId: "request-id",
          method: "GET",
          originalUrl: "/api/public/email-preferences?token=secret-value&view=all"
        },
        response,
        () => {}
      );
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).not.toContain("secret-value");
      expect(response.json.mock.calls[0][0].error.path).not.toContain("secret-value");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("migration is staging-only and creates service-only ledgers", () => {
    expect(() => assertCommunicationsMigrationTarget({
      targetEnvironment: "production",
      acknowledgement: "apply-communications-system-staging",
      connectionString: "postgresql://example.invalid/postgres"
    })).toThrow(/intentionally rejected/i);

    const sql = fs.readFileSync(
      path.resolve(__dirname, "../scripts/communications_system_schema.sql"),
      "utf8"
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_generations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.email_preferences/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.alumni_contacts/);
    expect(sql).toMatch(/ai_generations_service_role_all/);
    expect(sql).toMatch(/email_preferences_service_role_all/);
    expect(sql).toMatch(/alumni_contacts_service_role_all/);
    expect(sql).not.toMatch(/raw_prompt|raw_response/);
  });
});
