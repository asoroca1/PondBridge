import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  createdByUserId: "created_by_user_id",
  subject: "subject",
  preheader: "preheader",
  body: "body",
  campaignType: "campaign_type",
  aiGenerationId: "ai_generation_id",
  complianceSnapshot: "compliance_snapshot",
  status: "status",
  targeting: "targeting",
  recipientCount: "recipient_count",
  excludedCount: "excluded_count",
  recipientsPreview: "recipients_preview",
  scheduledFor: "scheduled_for",
  sentAt: "sent_at",
  stats: "stats",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const EmailBroadcastModel = createModel("email_broadcasts", COLUMNS);
