import { createModel } from "./_factory.js";

const COLUMNS = {
  id: "id",
  tenantId: "tenant_id",
  slug: "slug",
  title: "title",
  shortDescription: "short_description",
  description: "description",
  whyItMatters: "why_it_matters",
  category: "category",
  coverImageUrl: "cover_image_url",
  createdByUserId: "created_by_user_id",
  createdByProfileId: "created_by_profile_id",
  creatorName: "creator_name",
  creatorAffiliation: "creator_affiliation",
  origin: "origin",
  status: "status",
  reviewNote: "review_note",
  approvedByUserId: "approved_by_user_id",
  approvedAt: "approved_at",
  goalAmountCents: "goal_amount_cents",
  amountRaisedCents: "amount_raised_cents",
  donorCount: "donor_count",
  featured: "featured",
  fundraisingOpen: "fundraising_open",
  isGeneralFund: "is_general_fund",
  charityDesignationId: "charity_designation_id",
  externalCheckoutUrl: "external_checkout_url",
  startDate: "start_date",
  endDate: "end_date",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

export const GivingCauseModel = createModel("giving_causes", COLUMNS);
