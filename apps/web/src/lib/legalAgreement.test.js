import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGE_POLICY_VERSION,
  LEGAL_AGREEMENT_VERSION,
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
      version: LEGAL_AGREEMENT_VERSION,
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
      version: LEGAL_AGREEMENT_VERSION,
      accepted: true,
      ageEligibilityConfirmed: true,
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION
    });
    expect(pending.acceptedAt).toEqual(expect.any(String));
  });

  it("keeps a pending acceptance timestamp stable across reads and writes", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    setPendingLegalAgreementAccepted("cedar", { ageEligibilityConfirmed: true });
    const first = readPendingLegalAgreement("cedar");
    setPendingLegalAgreementAccepted("cedar", { ageEligibilityConfirmed: true });

    expect(readPendingLegalAgreement("cedar")).toEqual(first);
  });

  it("rejects stale legal tuples instead of upgrading them", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    sessionStorage.setItem(
      "pondbridgeLegalAgreement:cedar",
      JSON.stringify({
        version: LEGAL_AGREEMENT_VERSION,
        accepted: true,
        acceptedAt: "2026-05-06T12:00:00.000Z",
        termsVersion: "old-terms",
        privacyVersion: LEGAL_PRIVACY_VERSION,
        ageEligibilityConfirmed: true,
        minimumAge: MINIMUM_MEMBER_AGE,
        agePolicyVersion: AGE_POLICY_VERSION
      })
    );

    expect(readPendingLegalAgreement("cedar")).toBeNull();
  });

  it("clears pending acceptance", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    setPendingLegalAgreementAccepted("cedar", { ageEligibilityConfirmed: true });
    clearPendingLegalAgreement("cedar");

    expect(readPendingLegalAgreement("cedar")).toBeNull();
  });

  it("preserves a complete current receipt from the previous unversioned storage format", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });
    const receipt = buildAcceptedLegalAgreementPayload({ acceptedAt: "2026-09-08T20:00:00.000Z", ageEligibilityConfirmed: true });
    const { version: _version, ...legacy } = receipt;
    sessionStorage.setItem("pondbridgeLegalAgreement:cedar", JSON.stringify(legacy));
    expect(readPendingLegalAgreement("cedar")).toEqual(receipt);
  });

  it("rejects an impossible calendar timestamp", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });
    const receipt = buildAcceptedLegalAgreementPayload({ acceptedAt: "2026-02-30T20:00:00.000Z", ageEligibilityConfirmed: true });
    sessionStorage.setItem("pondbridgeLegalAgreement:cedar", JSON.stringify(receipt));
    expect(readPendingLegalAgreement("cedar")).toBeNull();
  });

  it("does not write acceptance without explicit age confirmation", () => {
    const sessionStorage = createStorage();
    vi.stubGlobal("window", { sessionStorage });

    expect(setPendingLegalAgreementAccepted("cedar")).toBeNull();

    expect(readPendingLegalAgreement("cedar")).toBeNull();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });
});
