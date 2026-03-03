/**
 * seedDemoCamp.js
 *
 * Creates (or resets) a "PondBridge Demo Camp" tenant with realistic fake
 * profiles, conversations, forum posts, and activity items.
 *
 * Safety:
 *   - Only operates on tenants whose slug matches the hidden/test pattern.
 *   - Idempotent: can be re-run without duplicating data.
 *   - Uses "demo_" prefixed IDs to clearly separate from real data.
 *
 * Usage:
 *   npm --workspace @pondbridge/api run seed:demo
 *   npm --workspace @pondbridge/api run seed:demo -- --reset   # wipe + reseed
 */

import dotenv from "dotenv";
import { connectToDatabase } from "../src/db/connect.js";
import {
  TenantModel,
  UserModel,
  ProfileModel,
  ForumModel,
  ForumPostModel,
  ConversationModel,
  MessageModel,
  ActivityItemModel
} from "../src/db/models/index.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const DEMO_SLUG = "demo";
const DEMO_TENANT_NAME = "PondBridge Demo Camp";
const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;

const DEMO_PROFILES = [
  { firstName: "Alex", lastName: "Rivera", roleAtCamp: "Director", industry: "Education", city: "Chicago, IL", bio: "Camp director for 15 years. Passionate about building community." },
  { firstName: "Sam", lastName: "Chen", roleAtCamp: "Head Counselor", industry: "Non-Profit", city: "New York, NY", bio: "Worked at camp every summer since 2010. Now running youth programs full-time." },
  { firstName: "Jordan", lastName: "Blake", roleAtCamp: "Counselor", industry: "Technology", city: "San Francisco, CA", bio: "Software engineer by day, camp counselor by summer. Best of both worlds." },
  { firstName: "Morgan", lastName: "Davis", roleAtCamp: "Camper", industry: "Finance", city: "Boston, MA", bio: "Attended camp 2008-2014. Those summers shaped who I am today." },
  { firstName: "Taylor", lastName: "Kim", roleAtCamp: "Counselor", industry: "Healthcare", city: "Seattle, WA", bio: "Pediatric nurse who got her start caring for campers." },
  { firstName: "Casey", lastName: "Thompson", roleAtCamp: "Camper", industry: "Marketing", city: "Austin, TX", bio: "Creative director at an agency. Camp taught me to think outside the box." },
  { firstName: "Riley", lastName: "Martinez", roleAtCamp: "Lifeguard", industry: "Sports & Recreation", city: "Miami, FL", bio: "Former Olympic trials swimmer. Camp waterfront was my training ground." },
  { firstName: "Avery", lastName: "Johnson", roleAtCamp: "Kitchen Staff", industry: "Hospitality", city: "Nashville, TN", bio: "Chef and restaurant owner. Learned my love of cooking at camp." },
  { firstName: "Quinn", lastName: "O'Brien", roleAtCamp: "Arts Instructor", industry: "Arts & Entertainment", city: "Portland, OR", bio: "Gallery artist. Those camp craft hours started it all." },
  { firstName: "Jamie", lastName: "Patel", roleAtCamp: "Camper", industry: "Law", city: "Washington, DC", bio: "Immigration attorney. Camp taught me empathy and advocacy." },
  { firstName: "Drew", lastName: "Nguyen", roleAtCamp: "Nature Guide", industry: "Environmental Science", city: "Denver, CO", bio: "Park ranger and conservation biologist." },
  { firstName: "Cameron", lastName: "Foster", roleAtCamp: "Counselor", industry: "Education", city: "Philadelphia, PA", bio: "High school teacher inspired by summers at camp." },
  { firstName: "Dakota", lastName: "Wright", roleAtCamp: "Camper", industry: "Real Estate", city: "Phoenix, AZ", bio: "Commercial real estate developer. Camp friendships are still my strongest network." },
  { firstName: "Skyler", lastName: "Adams", roleAtCamp: "Music Director", industry: "Music", city: "Los Angeles, CA", bio: "Session musician and producer. First performed at the camp talent show." },
  { firstName: "Parker", lastName: "Lee", roleAtCamp: "Camper", industry: "Consulting", city: "Atlanta, GA", bio: "Management consultant. Camp leadership experiences prepared me for everything." },
  { firstName: "Reese", lastName: "Campbell", roleAtCamp: "Maintenance", industry: "Construction", city: "Minneapolis, MN", bio: "General contractor. Fixed my first roof at camp." },
  { firstName: "Finley", lastName: "Scott", roleAtCamp: "Nurse", industry: "Healthcare", city: "Charlotte, NC", bio: "Family nurse practitioner. Started as the camp nurse in 2015." },
  { firstName: "Hayden", lastName: "Baker", roleAtCamp: "Counselor", industry: "Technology", city: "Raleigh, NC", bio: "Product manager at a startup. Camp taught me teamwork before agile did." },
  { firstName: "Emerson", lastName: "Clark", roleAtCamp: "Camper", industry: "Journalism", city: "Detroit, MI", bio: "Reporter covering community stories. The camp newsletter was my first byline." },
  { firstName: "Sage", lastName: "Turner", roleAtCamp: "Ropes Course Instructor", industry: "Fitness", city: "Salt Lake City, UT", bio: "Personal trainer and climbing gym owner." },
  { firstName: "Rowan", lastName: "Harris", roleAtCamp: "Camper", industry: "Agriculture", city: "Des Moines, IA", bio: "Running the family farm. Camp garden program sparked the passion." },
  { firstName: "Blair", lastName: "Mitchell", roleAtCamp: "Head of Waterfront", industry: "Insurance", city: "Columbus, OH", bio: "Actuary by trade, sailor at heart." },
  { firstName: "Lennox", lastName: "Brooks", roleAtCamp: "Counselor", industry: "Social Work", city: "Baltimore, MD", bio: "Youth social worker. Camp showed me the power of mentorship." },
  { firstName: "Ellis", lastName: "Ward", roleAtCamp: "Camper", industry: "Biotech", city: "San Diego, CA", bio: "Research scientist developing therapies. Camp science lab memories are still vivid." },
  { firstName: "Marlowe", lastName: "Cooper", roleAtCamp: "Program Director", industry: "Events", city: "Las Vegas, NV", bio: "Event planner. Organized my first event as camp program director." }
];

const COLLEGES = [
  "University of Michigan", "Stanford University", "Boston University",
  "UCLA", "NYU", "University of Texas at Austin", "Georgetown University",
  "Northwestern University", "Emory University", "University of Virginia",
  "Vanderbilt University", "University of Wisconsin", "Tulane University",
  "University of Colorado Boulder", "Indiana University"
];

const FORUM_TOPICS = [
  { title: "Reunion Planning 2026", body: "Who's interested in a reunion this summer? Let's coordinate dates and location." },
  { title: "Camp Recipes", body: "Does anyone have the recipe for the famous camp cookies? My kids keep asking for them." },
  { title: "Career Networking", body: "I'm looking for connections in the tech industry. Any fellow alumni working in product management?" },
  { title: "Photo Share Thread", body: "Post your favorite camp photos here! Looking for pictures from the 2012 season especially." },
  { title: "Volunteer Opportunities", body: "The camp is looking for alumni volunteers for the upcoming season. Great way to give back!" }
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomYear(min = 2005, max = 2023) {
  return String(min + Math.floor(Math.random() * (max - min + 1)));
}

async function purgeExistingDemoData(tenantId) {
  // Delete in correct order (respecting FK constraints).
  const tables = [
    MessageModel,
    ForumPostModel,
    ConversationModel,
    ForumModel,
    ActivityItemModel,
    ProfileModel,
    UserModel
  ];

  const counts = {};
  for (const model of tables) {
    const deleted = await model.deleteMany(tenantId, {});
    counts[model.tableName || "unknown"] = deleted?.length ?? 0;
  }
  return counts;
}

async function run() {
  const args = process.argv.slice(2);
  const shouldReset = args.includes("--reset");

  await connectToDatabase();

  // Find or create the demo tenant.
  let tenant = await TenantModel.findBySlug(DEMO_SLUG);

  if (tenant && shouldReset) {
    console.log(`[seed:demo] Resetting existing demo tenant: ${tenant._id}`);
    const counts = await purgeExistingDemoData(tenant._id);
    console.log("[seed:demo] Purged existing data:", counts);
  }

  if (!tenant) {
    console.log("[seed:demo] Creating demo tenant...");
    tenant = await TenantModel.create({
      name: DEMO_TENANT_NAME,
      slug: DEMO_SLUG,
      status: "active",
      planTier: "premium",
      billingStatus: "active",
      onboardingStatus: "live",
      onboardingStep: "review_launch",
      onboardingChecklist: [
        { id: "name_branding", label: "Brand your network", status: "completed", completedAt: new Date().toISOString() },
        { id: "welcome_message", label: "Name and welcome message", status: "completed", completedAt: new Date().toISOString() },
        { id: "signup_controls", label: "Choose who can join", status: "completed", completedAt: new Date().toISOString() },
        { id: "import_alumni", label: "Import your alumni list", status: "completed", completedAt: new Date().toISOString() },
        { id: "modules", label: "Enable modules", status: "completed", completedAt: new Date().toISOString() },
        { id: "review_launch", label: "Review and launch", status: "completed", completedAt: new Date().toISOString() }
      ],
      theme: {
        brandPrimary: "#1e6b3a",
        brandSecondary: "#e8f5e9",
        brandAccent: "#ffc107",
        bg: "#f5f7fa",
        text: "#0f172a",
        card: "#ffffff",
        logoUrl: "",
        heroImageUrl: "",
        typography: "Inter",
        fontFamily: "Inter",
        fontToken: "demo_default"
      },
      content: {
        networkDisplayName: DEMO_TENANT_NAME,
        welcomeHeadline: "Welcome to the PondBridge Demo Camp",
        welcomeBody: "This is a demo network for testing and demonstrations. All profiles and data are fictional.",
        aboutText: "PondBridge Demo Camp is used for testing new features and demonstrating the platform to prospective camps.",
        contactEmail: "demo@pondbridge.local",
        supportUrl: "",
        footerLinks: []
      },
      settings: {
        signupMode: "open",
        accessCodeHash: "",
        accessCodeHint: "",
        allowedEmailDomains: [],
        allowSearchByDefault: true,
        allowDirectoryBrowse: true,
        requireProfileCompletion: false
      },
      modules: {
        directory: true,
        search: true,
        photoStream: true,
        chat: true,
        map: true,
        familyTrees: true,
        relatedProfiles: true,
        newsletter: true,
        merchShop: true
      },
      accessSettings: { signupMode: "open", accessCode: "" },
      launch: {
        launchedAt: new Date().toISOString(),
        launchedByUserId: null
      }
    });
    console.log(`[seed:demo] Created demo tenant: ${tenant._id}`);
  } else {
    console.log(`[seed:demo] Using existing demo tenant: ${tenant._id}`);
  }

  // Verify the slug is safe (matches hidden pattern).
  if (!HIDDEN_TENANT_PATTERN.test(tenant.slug) && !HIDDEN_TENANT_PATTERN.test(tenant.name)) {
    throw new Error(
      `Safety check failed: tenant slug "${tenant.slug}" does not match the hidden/test pattern. ` +
        "Demo seed only operates on test/demo/sandbox tenants."
    );
  }

  // Create demo users and profiles.
  const createdUsers = [];
  const createdProfiles = [];

  for (let i = 0; i < DEMO_PROFILES.length; i++) {
    const p = DEMO_PROFILES[i];
    const email = `${p.firstName.toLowerCase()}.${p.lastName.toLowerCase()}@demo.pondbridge.local`;

    // Check if user already exists (idempotent).
    let user = await UserModel.findOne(tenant._id, { email });
    if (!user) {
      user = await UserModel.create({
        tenantId: tenant._id,
        email,
        roles: i === 0 ? ["tenant_admin", "user"] : ["user"],
        status: "active",
        metadata: { isDemoUser: true }
      });
    }

    // Check if profile already exists.
    let profile = await ProfileModel.findByUserId(tenant._id, user._id);
    const college = randomItem(COLLEGES);
    const collegeYear = randomYear(2005, 2022);

    const profileData = {
      tenantId: tenant._id,
      userId: user._id,
      firstName: p.firstName,
      lastName: p.lastName,
      emails: [email],
      phones: [`555-${String(100 + i).padStart(3, "0")}-${String(1000 + i).padStart(4, "0")}`],
      cityState: p.city,
      roleAtCamp: p.roleAtCamp,
      highSchool: `${p.city.split(",")[0]} High School`,
      colleges: [college],
      collegeYears: [collegeYear],
      currentJobs: [{ role: p.roleAtCamp === "Director" ? "Camp Director" : `${p.industry} Professional`, company: `${p.lastName} & Co`, years: "2020-Present" }],
      pastJobs: [{ role: "Summer Staff", company: DEMO_TENANT_NAME, years: `${randomYear(2008, 2019)}-${randomYear(2019, 2023)}` }],
      industry: p.industry,
      socials: { linkedin: "", instagram: "", facebook: "", nickname: "" },
      avatarUrl: "",
      bio: p.bio
    };

    if (profile) {
      profile = await ProfileModel.update(profile._id, profileData);
    } else {
      profile = await ProfileModel.create(profileData);
    }

    // Link profile to user.
    if (!user.profileId || user.profileId !== profile._id) {
      await UserModel.update(user._id, { profileId: profile._id });
    }

    createdUsers.push(user);
    createdProfiles.push(profile);

    // Create join activity item.
    await ActivityItemModel.create({
      tenantId: tenant._id,
      actorUserId: user._id,
      actorProfileId: profile._id,
      type: "user.join",
      metadata: { firstName: p.firstName, lastName: p.lastName }
    }).catch(() => {});
  }

  console.log(`[seed:demo] Created/updated ${createdProfiles.length} profiles.`);

  // Create demo forums and posts.
  for (const topic of FORUM_TOPICS) {
    let forum = null;
    try {
      const existing = await ForumModel.findOne(tenant._id, { title: topic.title });
      if (!existing) {
        forum = await ForumModel.create({
          tenantId: tenant._id,
          title: topic.title,
          description: topic.body,
          createdByUserId: createdUsers[0]._id
        });
      } else {
        forum = existing;
      }
    } catch {
      continue;
    }

    if (forum) {
      // Add a couple of posts from random users.
      const poster = randomItem(createdUsers);
      const posterProfile = createdProfiles[createdUsers.indexOf(poster)];
      await ForumPostModel.create({
        tenantId: tenant._id,
        forumId: forum._id,
        authorUserId: poster._id,
        authorProfileId: posterProfile?._id || "",
        body: `Great topic! I'm ${posterProfile?.firstName || "someone"} and I'd love to participate.`
      }).catch(() => {});
    }
  }

  console.log(`[seed:demo] Created ${FORUM_TOPICS.length} forum topics.`);

  // Create a sample conversation.
  try {
    const existingConversation = await ConversationModel.findOne(tenant._id, {});
    if (!existingConversation && createdUsers.length >= 2) {
      const conv = await ConversationModel.create({
        tenantId: tenant._id,
        participantUserIds: [createdUsers[0]._id, createdUsers[1]._id],
        participantProfileIds: [createdProfiles[0]?._id, createdProfiles[1]?._id].filter(Boolean)
      });

      await MessageModel.create({
        tenantId: tenant._id,
        conversationId: conv._id,
        senderUserId: createdUsers[0]._id,
        senderProfileId: createdProfiles[0]?._id || "",
        body: "Hey! Great to reconnect on PondBridge. How have you been?"
      });

      await MessageModel.create({
        tenantId: tenant._id,
        conversationId: conv._id,
        senderUserId: createdUsers[1]._id,
        senderProfileId: createdProfiles[1]?._id || "",
        body: "So good to hear from you! Things are great. Are you coming to the reunion?"
      });

      console.log("[seed:demo] Created sample conversation.");
    }
  } catch {
    // Conversations may not support all fields, skip gracefully.
  }

  console.log("[seed:demo] Done!");
  console.log(`[seed:demo] Demo camp URL: http://localhost:5173/t/${DEMO_SLUG}`);
  console.log(`[seed:demo] ${createdProfiles.length} profiles, ${FORUM_TOPICS.length} forums`);
}

run().catch((error) => {
  console.error("[seed:demo] Error:", error);
  process.exit(1);
});
