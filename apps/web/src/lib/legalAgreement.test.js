import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGE_POLICY_VERSION,
  LEGAL_PRIVACY_VERSION,
  LEGAL_TERMS_VERSION,
  MINIMUM_MEMBER_AGE,
  buildAcceptedLegalAgreementPayload,
  clearPendingLegalAgreement,
  readPendingLegalAgreement,
  setPendingLegalAgreementAccepted
} from "./legalAgreement.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key))
  };
}

describe("legal agreement storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds accepted payloads with current legal versions", () => {
    expect(buildAcceptedLegalAgreementPayload({
      acceptedAt: "2026-05-06T12:00:00.000Z",
      ageEligibilityConfirmed: true
    })).toEqual({
      accepted: true,
      acceptedAt: "2026-05-06T12:00:00.000Z",
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
      ageEligibilityConfirmed: true,
      minimumAge: MINIMUM_MEMBER_AGE,
      agePolicyVersion: AGE_POLICY_VERSION
    });
  });

  it("stores and reads pending acceptance per normalized tenant slug", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    setPendingLegalAgreementAccepted(" Cedar ", { ageEligibilityConfirmed: true });
    const pending = readPendingLegalAgreement("cedar");

    expect(pending).toMatchObject({
      accepted: true,
      ageEligibilityConfirmed: true,
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION
    });
    expect(pending.acceptedAt).toEqual(expect.any(String));
  });

  it("clears pending acceptance", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    setPendingLegalAgreementAccepted("cedar", { ageEligibilityConfirmed: true });
    clearPendingLegalAgreement("cedar");

    expect(readPendingLegalAgreement("cedar")).toBeNull();
  });

  it("does not treat legal acceptance without age confirmation as complete", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    setPendingLegalAgreementAccepted("cedar");

    expect(readPendingLegalAgreement("cedar")).toBeNull();
  });
});
