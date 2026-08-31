import {
  AccessRequestModel,
  ActivityItemModel,
  AlumniContactModel,
  AnalyticsEventModel,
  ContentReportModel,
  ConversationModel,
  EmailBroadcastModel,
  EmailSuppressionModel,
  EventMessageModel,
  EventModel,
  EventRsvpModel,
  FamilyTreeModel,
  ForumModel,
  ForumPostModel,
  ImportReportModel,
  InviteModel,
  MagicLinkTokenModel,
  MemberBlockModel,
  MessageModel,
  MobileNotificationDeviceModel,
  MobileNotificationModel,
  MobileNotificationPreferenceModel,
  MobileNotificationScheduleModel,
  MobileNotificationTemplateModel,
  NewsletterModel,
  PhotoModel,
  ProfileModel,
  ResendWebhookEventModel,
  ResumeParseResultModel,
  StripeWebhookEventModel,
  TenantAdminAuditLogModel,
  UserModel
} from "../db/models/index.js";
import { removeAllTenantMembershipIdentityLinks } from "./identityUsers.js";

// Every table whose tenant_id foreign key is NOT declared ON DELETE CASCADE has
// to be emptied here, or the final tenant row delete fails with a foreign key
// violation and leaves the camp half-wiped.  Order matters: rows that reference
// another row in this list (messages → conversations, mobile notifications →
// users) must be purged before the row they point at.  The coverage test in
// tests/tenantPurgeCoverage.test.js reads the schema and fails when a new
// tenant-scoped table is added without a step here.
export const TENANT_PURGE_STEPS = [
  { key: "messages", model: MessageModel },
  { key: "forumPosts", model: ForumPostModel },
  { key: "conversations", model: ConversationModel },
  { key: "forums", model: ForumModel },
  { key: "eventMessages", model: EventMessageModel },
  { key: "eventRsvps", model: EventRsvpModel },
  { key: "events", model: EventModel },
  { key: "photos", model: PhotoModel },
  { key: "newsletters", model: NewsletterModel },
  { key: "emailBroadcasts", model: EmailBroadcastModel },
  { key: "familyTrees", model: FamilyTreeModel },
  { key: "importReports", model: ImportReportModel },
  { key: "analyticsEvents", model: AnalyticsEventModel },
  { key: "tenantAuditLogs", model: TenantAdminAuditLogModel },
  { key: "resumeParseResults", model: ResumeParseResultModel },
  { key: "activityItems", model: ActivityItemModel },
  { key: "contentReports", model: ContentReportModel },
  { key: "memberBlocks", model: MemberBlockModel },
  { key: "mobileNotifications", model: MobileNotificationModel },
  { key: "mobileNotificationDevices", model: MobileNotificationDeviceModel },
  { key: "mobileNotificationPreferences", model: MobileNotificationPreferenceModel },
  { key: "mobileNotificationSchedules", model: MobileNotificationScheduleModel },
  { key: "mobileNotificationTemplates", model: MobileNotificationTemplateModel },
  { key: "resendWebhookEvents", model: ResendWebhookEventModel },
  { key: "stripeWebhookEvents", model: StripeWebhookEventModel },
  { key: "emailSuppressions", model: EmailSuppressionModel },
  { key: "magicLinkTokens", model: MagicLinkTokenModel },
  { key: "accessRequests", model: AccessRequestModel },
  { key: "invites", model: InviteModel },
  { key: "alumniContacts", model: AlumniContactModel },
  { key: "profiles", model: ProfileModel },
  { key: "users", model: UserModel }
];

export async function purgeTenantRows(tenantId) {
  const counts = {};

  const identityCleanup = await removeAllTenantMembershipIdentityLinks(tenantId);
  counts.tenantMemberships = identityCleanup.membershipsDeleted;
  counts.unusedIdentities = identityCleanup.identitiesDeleted;
  counts.identityStorageAvailable = identityCleanup.storageAvailable;

  for (const step of TENANT_PURGE_STEPS) {
    const existing = await step.model.count(tenantId, {});
    counts[step.key] = existing;
    if (existing > 0) {
      await step.model.deleteMany(tenantId, {});
    }
  }

  return counts;
}
