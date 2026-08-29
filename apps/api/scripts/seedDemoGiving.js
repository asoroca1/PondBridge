/**
 * seedDemoGiving.js
 *
 * Fills a demo camp's Giving marketplace with a general fund, approved alumni
 * causes, a pending cause for the director review queue, donations, and cause
 * updates — so the Giving tab has something to show in a live demo.
 *
 * Safety:
 *   - Refuses any tenant whose slug does not look like a demo/test camp.
 *   - Idempotent: every row uses a deterministic "demo_giving_" id, so re-runs
 *     update in place instead of duplicating.
 *   - Only ever touches rows carrying that prefix.
 *
 * Usage:
 *   npm --workspace @pondbridge/api run seed:demo:giving
 *   npm --workspace @pondbridge/api run seed:demo:giving -- --slug=vega-demo
 *   npm --workspace @pondbridge/api run seed:demo:giving -- --reset
 *   npm --workspace @pondbridge/api run seed:demo:giving -- --checkout-url=https://...
 *
 * Requires the giving marketplace migration
 * (supabase/migrations/20260828194440_add_giving_marketplace.sql) to have run
 * against the target database first.
 */

import dotenv from "dotenv";
import { connectToDatabase } from "../src/db/connect.js";
import {
  TenantModel,
  UserModel,
  ProfileModel,
  GivingCauseModel,
  GivingDonationModel,
  GivingCauseUpdateModel
} from "../src/db/models/index.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const DEFAULT_SLUG = "green-lane-demo";
const ID_PREFIX = "demo_giving_";
// Mirrors seedDemoCamp.js: only camps that announce themselves as demo/test.
const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;

function readFlag(args, name) {
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }
  return "";
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function firstEmail(profile = {}) {
  const emails = profile.emails;
  const candidate = Array.isArray(emails) ? emails[0] : emails;
  if (!candidate) return "";
  if (typeof candidate === "string") return candidate;
  return String(candidate.email || candidate.address || "");
}

function shortName(profile = {}) {
  const first = String(profile.firstName || "").trim();
  const last = String(profile.lastName || "").trim();
  if (!first) return "Alumni supporter";
  return last ? `${first} ${last.charAt(0)}.` : first;
}

function affiliation(profile = {}) {
  return String(profile.roleAtCamp || "Alumni").trim().slice(0, 80);
}

/**
 * The causes carry the headline totals (the member page sums
 * amountRaisedCents/donorCount across causes), while the donations below are
 * the "recent supporters" wall — a visible subset, not the whole history.
 */
function buildCauses({ tenant, directorUserId, creators }) {
  const campName = tenant.name || "camp";
  return [
    {
      key: "general-fund",
      slug: slugify(`support ${campName}`) || "support-camp",
      title: `Support ${campName}`,
      shortDescription: "Give where camp needs it most.",
      description:
        `Unrestricted gifts let ${campName} respond to whatever the season asks for — a roof that ` +
        "cannot wait, a camper who needs a spot, a program worth keeping alive.",
      whyItMatters:
        "A strong general fund keeps the places, people, and traditions alumni love ready for the next summer.",
      category: "other",
      origin: "official",
      status: "active",
      createdByUserId: directorUserId,
      createdByProfileId: null,
      creatorName: campName,
      creatorAffiliation: "",
      approvedByUserId: directorUserId,
      approvedAt: daysAgo(180),
      goalAmountCents: 0,
      amountRaisedCents: 3_250_000,
      donorCount: 112,
      featured: true,
      fundraisingOpen: true,
      isGeneralFund: true,
      charityDesignationId: "general-fund",
      startDate: isoDay(daysAgo(180)),
      endDate: null
    },
    {
      key: "camperships",
      slug: "send-a-camper",
      title: "Send a Camper to Camp",
      shortDescription: "Cover a first summer for a family who could not otherwise say yes.",
      description:
        "Every campership is a full session — bunk, meals, trips, and the duffel of gear that goes with it. " +
        "Families apply through the camp office and awards stay confidential.",
      whyItMatters:
        "Alumni say their first summer changed the shape of their life. This is how someone else gets that summer.",
      category: "camperships",
      origin: "official",
      status: "active",
      createdByUserId: directorUserId,
      createdByProfileId: null,
      creatorName: campName,
      creatorAffiliation: "",
      approvedByUserId: directorUserId,
      approvedAt: daysAgo(120),
      goalAmountCents: 5_000_000,
      amountRaisedCents: 2_840_000,
      donorCount: 96,
      featured: true,
      fundraisingOpen: true,
      isGeneralFund: false,
      charityDesignationId: "",
      startDate: isoDay(daysAgo(120)),
      endDate: isoDay(daysAgo(-90))
    },
    {
      key: "council-ring",
      slug: "rebuild-the-council-ring",
      title: "Rebuild the Council Ring",
      shortDescription: "New benches, safe footing, and low path lighting for the last night of every session.",
      description:
        "The ring has not been touched since the nineties. The plan replaces the benches, regrades the " +
        "seating bowl so it drains, and adds low path lighting so the walk down is safe after dark.",
      whyItMatters:
        "It is where closing campfire happens. Ask any alum what they remember and this is the place they name.",
      category: "facilities",
      origin: "alumni_led",
      status: "active",
      createdByUserId: creators[0]?.userId || null,
      createdByProfileId: creators[0]?.profileId || null,
      creatorName: creators[0]?.name || "Alumni committee",
      creatorAffiliation: creators[0]?.affiliation || "Alumni",
      approvedByUserId: directorUserId,
      approvedAt: daysAgo(60),
      goalAmountCents: 1_200_000,
      amountRaisedCents: 815_000,
      donorCount: 63,
      featured: false,
      fundraisingOpen: true,
      isGeneralFund: false,
      charityDesignationId: "",
      startDate: isoDay(daysAgo(60)),
      endDate: isoDay(daysAgo(-90))
    },
    {
      key: "arts-cabin",
      slug: "arts-cabin-renewal",
      title: "Arts Cabin Renewal",
      shortDescription: "Fully funded by alumni — new kilns, wheels, and a roof that keeps the rain out.",
      description:
        "Alumni funded a full renewal of the arts cabin: two kilns, four wheels, proper ventilation, and " +
        "the roof repair that had been deferred for six years.",
      whyItMatters:
        "The cabin ran at capacity every session. Now it can stay open through the shoulder weeks too.",
      category: "programs",
      origin: "alumni_led",
      status: "completed",
      createdByUserId: creators[1]?.userId || null,
      createdByProfileId: creators[1]?.profileId || null,
      creatorName: creators[1]?.name || "Alumni committee",
      creatorAffiliation: creators[1]?.affiliation || "Alumni",
      approvedByUserId: directorUserId,
      approvedAt: daysAgo(300),
      goalAmountCents: 900_000,
      amountRaisedCents: 900_000,
      donorCount: 41,
      featured: false,
      fundraisingOpen: false,
      isGeneralFund: false,
      charityDesignationId: "",
      startDate: isoDay(daysAgo(300)),
      endDate: isoDay(daysAgo(150))
    },
    {
      // Left pending on purpose: the director Giving workspace should open on a
      // real review queue, not an empty state.
      key: "waterfront",
      slug: "waterfront-dock-repairs",
      title: "Waterfront Dock Repairs",
      shortDescription: "Replace the swim dock decking and re-anchor the far raft.",
      description:
        "Two sections of decking failed inspection last August and the far raft drifts in a strong wind. " +
        "This covers marine-grade decking, new hardware, and re-anchoring before the season opens.",
      whyItMatters:
        "Swim instruction stops entirely if the dock fails inspection again.",
      category: "facilities",
      origin: "alumni_led",
      status: "pending",
      createdByUserId: creators[2]?.userId || null,
      createdByProfileId: creators[2]?.profileId || null,
      creatorName: creators[2]?.name || "Alumni committee",
      creatorAffiliation: creators[2]?.affiliation || "Alumni",
      approvedByUserId: null,
      approvedAt: null,
      goalAmountCents: 1_500_000,
      amountRaisedCents: 0,
      donorCount: 0,
      featured: false,
      fundraisingOpen: true,
      isGeneralFund: false,
      charityDesignationId: "",
      startDate: isoDay(daysAgo(4)),
      endDate: isoDay(daysAgo(-120))
    }
  ];
}

function buildDonations(donors) {
  const pick = (index) => donors[index % Math.max(donors.length, 1)] || null;
  return [
    {
      key: "council-01",
      causeKey: "council-ring",
      donor: pick(0),
      amountCents: 100_000,
      displayPreference: "public",
      donorMessage: "For the summers that changed my life.",
      daysAgo: 2
    },
    {
      key: "council-02",
      causeKey: "council-ring",
      donor: pick(1),
      amountCents: 50_000,
      displayPreference: "public",
      donorMessage: "",
      daysAgo: 4
    },
    {
      key: "council-03",
      causeKey: "council-ring",
      donor: pick(2),
      amountCents: 25_000,
      displayPreference: "anonymous",
      donorMessage: "Keep the fire bright.",
      daysAgo: 6
    },
    {
      key: "council-04",
      causeKey: "council-ring",
      donor: pick(3),
      amountCents: 10_000,
      displayPreference: "hide_amount",
      donorMessage: "",
      daysAgo: 9
    },
    {
      key: "council-05",
      causeKey: "council-ring",
      donor: pick(4),
      amountCents: 7_500,
      displayPreference: "public",
      donorMessage: "Every bench counts.",
      daysAgo: 13
    },
    {
      key: "campership-01",
      causeKey: "camperships",
      donor: pick(5),
      amountCents: 100_000,
      displayPreference: "public",
      donorMessage: "Everyone deserves a first summer here.",
      daysAgo: 3
    },
    {
      key: "campership-02",
      causeKey: "camperships",
      donor: pick(6),
      amountCents: 25_000,
      displayPreference: "public",
      donorMessage: "",
      daysAgo: 11
    },
    {
      key: "general-01",
      causeKey: "general-fund",
      donor: pick(7),
      amountCents: 50_000,
      displayPreference: "public",
      donorMessage: "Use it wherever it helps most.",
      daysAgo: 1
    },
    {
      key: "general-02",
      causeKey: "general-fund",
      donor: pick(8),
      amountCents: 20_000,
      displayPreference: "anonymous",
      donorMessage: "",
      daysAgo: 8
    },
    {
      key: "arts-01",
      causeKey: "arts-cabin",
      donor: pick(9),
      amountCents: 15_000,
      displayPreference: "public",
      donorMessage: "Still have the mug I made in 2009.",
      daysAgo: 160
    }
  ];
}

function buildUpdates(directorUserId) {
  return [
    {
      key: "council-01",
      causeKey: "council-ring",
      title: "Two-thirds of the way there",
      body:
        "We crossed $8,000 this week. Thank you to everyone helping bring the Council Ring back to life.",
      milestoneType: "percent",
      daysAgo: 5
    },
    {
      key: "council-02",
      causeKey: "council-ring",
      title: "Plans approved",
      body:
        "The camp team approved the bench layout and the low-impact path lighting. Work begins as soon as " +
        "the campaign is funded.",
      milestoneType: "update",
      daysAgo: 18
    },
    {
      key: "campership-01",
      causeKey: "camperships",
      title: "Nineteen camperships awarded",
      body: "Nineteen families have been offered a full session so far this year.",
      milestoneType: "update",
      daysAgo: 21
    },
    {
      key: "arts-01",
      causeKey: "arts-cabin",
      title: "Funded by alumni",
      body: "The Arts Cabin Renewal is fully funded. Installation begins after closing day.",
      milestoneType: "completed",
      daysAgo: 150
    }
  ].map((update) => ({ ...update, authorUserId: directorUserId }));
}

async function purgeSeededGiving(tenantId) {
  const causes = await GivingCauseModel.find(tenantId, {}, { limit: 500 });
  const seededIds = causes
    .map((cause) => String(cause._id || cause.id || ""))
    .filter((id) => id.startsWith(ID_PREFIX));

  if (!seededIds.length) return { causes: 0 };

  await GivingCauseUpdateModel.deleteMany(tenantId, { causeId: { $in: seededIds } });
  await GivingDonationModel.deleteMany(tenantId, { causeId: { $in: seededIds } });
  await GivingCauseModel.deleteMany(tenantId, { _id: { $in: seededIds } });
  return { causes: seededIds.length };
}

async function run() {
  const args = process.argv.slice(2);
  const slug = (readFlag(args, "slug") || DEFAULT_SLUG).trim().toLowerCase();
  const shouldReset = args.includes("--reset");
  const checkoutUrl = readFlag(args, "checkout-url").trim();

  if (!HIDDEN_TENANT_PATTERN.test(slug)) {
    throw new Error(
      `Refusing to seed giving data into "${slug}" — this script only runs against demo/test camps.`
    );
  }

  if (checkoutUrl && !/^https:\/\//i.test(checkoutUrl)) {
    throw new Error("--checkout-url must be an https URL.");
  }

  await connectToDatabase();

  const tenant = await TenantModel.findBySlug(slug);
  if (!tenant) throw new Error(`No tenant found for slug "${slug}".`);
  const tenantId = tenant._id;

  if (shouldReset) {
    const purged = await purgeSeededGiving(tenantId);
    console.log(`[seed:demo:giving] Purged ${purged.causes} previously seeded cause(s).`);
  }

  // A general fund is unique per tenant. If one already exists that this script
  // did not create, stop rather than collide with it.
  const existingGeneralFund = await GivingCauseModel.findOne(tenantId, { isGeneralFund: true });
  const existingGeneralFundId = String(existingGeneralFund?._id || "");
  if (existingGeneralFundId && !existingGeneralFundId.startsWith(ID_PREFIX)) {
    throw new Error(
      `"${slug}" already has a general fund (${existingGeneralFundId}) that this script did not create. ` +
        "Remove it or run with --reset after clearing it."
    );
  }

  const users = await UserModel.find(tenantId, {}, { limit: 500 });
  const director = users.find((user) => (user.roles || []).includes("tenant_admin")) || null;
  const directorUserId = director?._id || null;
  if (!directorUserId) {
    console.warn(`[seed:demo:giving] No tenant_admin user on "${slug}" — causes will have no approver.`);
  }

  const profiles = await ProfileModel.find(tenantId, {}, { limit: 24, sort: { createdAt: 1 } });
  const usersByProfileId = new Map(
    users.filter((user) => user.profileId).map((user) => [String(user.profileId), user])
  );
  const people = profiles.map((profile) => {
    const profileId = String(profile._id || "");
    const user = usersByProfileId.get(profileId) || null;
    return {
      profileId,
      userId: user?._id || null,
      name: shortName(profile),
      affiliation: affiliation(profile),
      email: firstEmail(profile) || `donor.${profileId.slice(-6)}@demo.invalid`
    };
  });

  if (people.length < 3) {
    throw new Error(`"${slug}" has too few profiles (${people.length}) to attribute causes to.`);
  }

  const causes = buildCauses({ tenant, directorUserId, creators: people });
  const causeIdByKey = new Map();

  for (const cause of causes) {
    const id = `${ID_PREFIX}cause_${cause.key}`;
    causeIdByKey.set(cause.key, id);
    const { key, ...fields } = cause;
    await GivingCauseModel.upsert({
      _id: id,
      tenantId,
      ...fields,
      coverImageUrl: "",
      reviewNote: "",
      // Left blank unless a checkout URL is supplied: an unset URL makes the
      // Donate button say online giving is not connected yet, which is the
      // truth until the camp wires up its own checkout.
      externalCheckoutUrl: cause.status === "active" ? checkoutUrl : ""
    });
  }
  console.log(`[seed:demo:giving] Upserted ${causes.length} causes.`);

  const donations = buildDonations(people);
  for (const donation of donations) {
    const causeId = causeIdByKey.get(donation.causeKey);
    if (!causeId) continue;
    const donor = donation.donor;
    const anonymous = donation.displayPreference === "anonymous";
    await GivingDonationModel.upsert({
      _id: `${ID_PREFIX}donation_${donation.key}`,
      tenantId,
      causeId,
      provider: "demo_seed",
      providerDonationId: `demo-${donation.key}`,
      donorUserId: anonymous ? null : donor?.userId || null,
      donorProfileId: anonymous ? null : donor?.profileId || null,
      donorDisplayName: anonymous ? "" : donor?.name || "Alumni supporter",
      donorAffiliation: anonymous ? "" : donor?.affiliation || "Alumni",
      donorEmail: donor?.email || "",
      amountCents: donation.amountCents,
      displayPreference: donation.displayPreference,
      donorMessage: donation.donorMessage,
      status: "succeeded",
      completedAt: daysAgo(donation.daysAgo),
      providerPayload: { demoSeed: true }
    });
  }
  console.log(`[seed:demo:giving] Upserted ${donations.length} donations.`);

  const updates = buildUpdates(directorUserId);
  for (const update of updates) {
    const causeId = causeIdByKey.get(update.causeKey);
    if (!causeId) continue;
    await GivingCauseUpdateModel.upsert({
      _id: `${ID_PREFIX}update_${update.key}`,
      tenantId,
      causeId,
      authorUserId: update.authorUserId,
      title: update.title,
      body: update.body,
      milestoneType: update.milestoneType,
      publishedAt: daysAgo(update.daysAgo)
    });
  }
  console.log(`[seed:demo:giving] Upserted ${updates.length} cause updates.`);

  if (!checkoutUrl) {
    console.log(
      "[seed:demo:giving] No --checkout-url given, so Donate will report that online giving is not connected."
    );
  }
  console.log(`[seed:demo:giving] Done for "${slug}".`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed:demo:giving] Failed:", error?.message || error);
    process.exit(1);
  });
