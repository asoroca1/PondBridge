import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  causeId: "cause_id",
  provider: "provider",
  providerDonationId: "provider_donation_id",
  donorUserId: "donor_user_id",
  donorProfileId: "donor_profile_id",
  donorDisplayName: "donor_display_name",
  donorAffiliation: "donor_affiliation",
  donorEmail: "donor_email",
  amountCents: "amount_cents",
  displayPreference: "display_preference",
  donorMessage: "donor_message",
  status: "status",
  completedAt: "completed_at",
  providerPayload: "provider_payload",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const GivingDonationModel = createModel("giving_donations", COLUMNS);
