import crypto from "crypto";
import { jest } from "@jest/globals";
import {
  classifyFcmHttpV1Error,
  hasFcmHttpV1Configuration,
  resetFcmHttpV1TokenCacheForTests,
  sendFcmHttpV1Message
} from "../src/services/fcmHttpV1.js";

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload
  };
}

function testConfig() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
  return {
    projectId: "pondbridge-staging-test",
    clientEmail: "firebase-push@pondbridge-staging-test.iam.gserviceaccount.com",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}

describe("Firebase Cloud Messaging HTTP v1", () => {
  beforeEach(() => {
    resetFcmHttpV1TokenCacheForTests();
  });

  test("requires the complete service-account configuration", () => {
    expect(hasFcmHttpV1Configuration({})).toBe(false);
    expect(hasFcmHttpV1Configuration({ projectId: "p", clientEmail: "e", privateKey: "k" })).toBe(true);
  });

  test("exchanges a signed service-account assertion and sends an Android notification", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ name: "projects/p/messages/message-1" }))
      .mockResolvedValueOnce(jsonResponse({ name: "projects/p/messages/message-2" }));
    const config = testConfig();
    const send = () => sendFcmHttpV1Message({
      config,
      token: "android-registration-token",
      title: "Camp update",
      body: "The waterfront schedule changed.",
      data: { notificationId: "notice-1", deepLink: "/notifications" },
      fetchImpl,
      now: () => 1_800_000_000_000
    });

    await expect(send()).resolves.toMatchObject({ ok: true, status: "delivered" });
    await expect(send()).resolves.toMatchObject({ ok: true, status: "delivered" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenRequest] = fetchImpl.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const tokenBody = new URLSearchParams(tokenRequest.body);
    expect(tokenBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertionParts = String(tokenBody.get("assertion") || "").split(".");
    expect(assertionParts).toHaveLength(3);
    const claims = JSON.parse(Buffer.from(assertionParts[1], "base64url").toString("utf8"));
    expect(claims).toMatchObject({
      iss: config.clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/firebase.messaging"
    });

    const [sendUrl, sendRequest] = fetchImpl.mock.calls[1];
    expect(sendUrl).toBe("https://fcm.googleapis.com/v1/projects/pondbridge-staging-test/messages:send");
    expect(sendRequest.headers.authorization).toBe("Bearer oauth-token");
    const message = JSON.parse(sendRequest.body).message;
    expect(message).toMatchObject({
      token: "android-registration-token",
      notification: {
        title: "Camp update",
        body: "The waterfront schedule changed."
      },
      data: {
        notificationId: "notice-1",
        deepLink: "/notifications"
      },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: "pondbridge_updates",
          sound: "default"
        }
      }
    });
  });

  test("marks only permanent device-token failures for deactivation", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          status: "NOT_FOUND",
          message: "Requested entity was not found.",
          details: [{
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "UNREGISTERED"
          }]
        }
      }, { ok: false, status: 404 }));

    await expect(sendFcmHttpV1Message({
      config: testConfig(),
      token: "expired-token",
      title: "Update",
      body: "Body",
      fetchImpl,
      now: () => 1_800_000_000_000
    })).resolves.toMatchObject({
      ok: false,
      status: "failed",
      permanent: true,
      error: expect.stringContaining("UNREGISTERED")
    });

    expect(classifyFcmHttpV1Error({ error: { status: "UNAVAILABLE", message: "Retry later" } }, 503))
      .toMatchObject({ code: "UNAVAILABLE", permanent: false });
  });
});
