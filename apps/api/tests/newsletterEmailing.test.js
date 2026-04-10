import {
  buildNewsletterAnnouncementEmail,
  collectTenantNewsletterRecipients
} from "../src/routes/legacyCedarCompat.js";

describe("newsletter emailing helpers", () => {
  test("collectTenantNewsletterRecipients includes active members and falls back to user email when needed", () => {
    const recipients = collectTenantNewsletterRecipients({
      users: [
        { id: "user-1", email: "account-one@example.com", status: "active" },
        { id: "user-2", email: "account-two@example.com", status: "active" },
        { id: "user-3", email: "removed-user@example.com", status: "active" },
        { id: "user-4", email: "profileless@example.com", status: "active" },
        { id: "user-5", email: "inactive@example.com", status: "inactive" }
      ],
      profiles: [
        { userId: "user-1", emails: ["profile-one@example.com"], status: "active" },
        { userId: "user-2", emails: ["not-an-email", ""], status: "active" },
        { userId: "user-3", emails: ["removed-profile@example.com"], status: "removed" },
        { userId: "", emails: ["guest@example.com"], status: "active" },
        { userId: "user-4", emails: ["profileless@example.com"], status: "active" }
      ]
    });

    expect(recipients.sort()).toEqual(
      [
        "account-two@example.com",
        "guest@example.com",
        "profile-one@example.com",
        "profileless@example.com"
      ].sort()
    );
  });

  test("buildNewsletterAnnouncementEmail creates a polished newsletter announcement", () => {
    const composed = buildNewsletterAnnouncementEmail({
      tenantName: "Camp Cedar",
      newsletterLabel: "Newsletter",
      title: "Summer & Sun",
      season: "Summer",
      year: "2026",
      archiveUrl: "https://pondbridge.test/t/camp-cedar/cedar-chest",
      pdfUrl: "https://pondbridge.test/files/newsletter.pdf",
      coverImageUrl: "https://pondbridge.test/files/newsletter-cover.jpg"
    });

    expect(composed.subject).toBe("New Newsletter: Summer & Sun");
    expect(composed.html).toContain("Open in PondBridge");
    expect(composed.html).toContain("Download PDF");
    expect(composed.html).toContain("newsletter-cover.jpg");
    expect(composed.html).toContain("Summer &amp; Sun");
    expect(composed.text).toContain("The PDF is attached to this email");
    expect(composed.text).toContain("Camp Cedar");
  });
});
