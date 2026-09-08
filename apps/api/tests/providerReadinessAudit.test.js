import { assessProvider, buildProviderReadinessAudit } from "../scripts/providerReadinessAudit.js";

function provider(id, overrides = {}) {
  return {
    id,
    label: id,
    source: "render.yaml",
    required: true,
    requiredConfiguration: [],
    ...overrides,
  };
}

describe("provider readiness audit", () => {
  it("never includes configured values in its report", () => {
    const secret = "must-not-appear";
    const audit = buildProviderReadinessAudit({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: secret,
      R2_BUCKET_NAME: "pondbridge-media",
      R2_ACCESS_KEY_ID: secret,
      R2_SECRET_ACCESS_KEY: secret,
      R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    });

    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("accepts an account id as the R2 endpoint source", () => {
    const result = assessProvider(
      provider("cloudflare_r2", {
        requiredConfiguration: ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
        oneOfConfiguration: [["R2_ENDPOINT", "CLOUDFLARE_ACCOUNT_ID"]],
      }),
      {
        R2_BUCKET_NAME: "pondbridge-media",
        R2_ACCESS_KEY_ID: "access",
        R2_SECRET_ACCESS_KEY: "secret",
        CLOUDFLARE_ACCOUNT_ID: "account",
      }
    );

    expect(result.status).toBe("configured");
    expect(result.missingConfiguration).toEqual([]);
  });

  it("keeps Stream disabled when no token is configured", () => {
    const result = assessProvider(
      provider("cloudflare_stream", {
        required: false,
        enabledWhen: (environment) =>
          Boolean(environment.CLOUDFLARE_ACCOUNT_ID && environment.CLOUDFLARE_API_TOKEN),
        requiredConfiguration: ["CLOUDFLARE_ACCOUNT_ID"],
        oneOfConfiguration: [["CLOUDFLARE_STREAM_API_TOKEN", "CLOUDFLARE_API_TOKEN"]],
      }),
      {}
    );

    expect(result.enabled).toBe(false);
    expect(result.status).toBe("disabled");
  });

  it("reports malformed provider URLs without echoing them", () => {
    const malformed = "not-a-url-with-sensitive-text";
    const result = assessProvider(
      provider("supabase", { requiredConfiguration: ["SUPABASE_URL"] }),
      { SUPABASE_URL: malformed }
    );

    expect(result.status).toBe("failure");
    expect(JSON.stringify(result)).not.toContain(malformed);
    expect(result.configurationErrors).toContain("SUPABASE_URL must be an http(s) URL");
  });
});
