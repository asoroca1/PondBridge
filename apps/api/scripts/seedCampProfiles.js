import dotenv from "dotenv";
import { connectToDatabase } from "../src/db/connect.js";
import {
  TenantModel,
  UserModel,
  ProfileModel,
  NewsletterModel,
  PhotoModel,
  FamilyTreeModel,
  ForumModel,
  ForumPostModel,
  ActivityItemModel
} from "../src/db/models/index.js";
import { hashPassword } from "../src/utils/auth.js";

dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

const HIDDEN_TENANT_PATTERN =
  /(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i;

const FIRST_NAMES = [
  "Alex", "Jordan", "Taylor", "Casey", "Morgan", "Sam", "Jamie", "Riley", "Avery", "Parker",
  "Drew", "Skyler", "Reese", "Blair", "Rowan", "Hayden", "Lennox", "Sage", "Quinn", "Emerson",
  "Cameron", "Dakota", "Finley", "Ellis", "Marlowe", "Noah", "Mia", "Ethan", "Chloe", "Lucas",
  "Nora", "Owen", "Lila", "Mason", "Ruby", "Logan", "Zoe", "Levi", "Ivy", "Asher"
];

const WOMEN_FIRST_NAMES = [
  "Abigail", "Addison", "Adeline", "Ainsley", "Alexandra", "Alice", "Amelia", "Anna", "Aria", "Aubrey",
  "Audrey", "Ava", "Bailey", "Bella", "Brianna", "Brooke", "Camila", "Caroline", "Charlotte", "Chloe",
  "Claire", "Clara", "Delaney", "Eleanor", "Elena", "Eliana", "Eliza", "Ella", "Ellie", "Emily",
  "Emma", "Eva", "Evelyn", "Gabriella", "Genevieve", "Grace", "Hailey", "Hannah", "Harper", "Hazel",
  "Isabella", "Isla", "Jade", "Josephine", "Julia", "Kayla", "Kennedy", "Layla", "Leah", "Lily",
  "Lillian", "Lucy", "Madeline", "Madison", "Maya", "Mia", "Naomi", "Natalie", "Nora", "Olivia",
  "Paige", "Penelope", "Piper", "Quinn", "Riley", "Ruby", "Samantha", "Savannah", "Scarlett", "Sienna",
  "Sofia", "Sophia", "Stella", "Sydney", "Taylor", "Valentina", "Victoria", "Violet", "Willow", "Zoey"
];

const LAST_NAMES = [
  "Rivera", "Chen", "Blake", "Davis", "Kim", "Thompson", "Martinez", "Johnson", "Patel", "Nguyen",
  "Foster", "Wright", "Adams", "Lee", "Campbell", "Scott", "Baker", "Clark", "Turner", "Harris",
  "Mitchell", "Brooks", "Ward", "Cooper", "Morris", "Perry", "Price", "Reed", "Bailey", "Cook",
  "Morgan", "Bell", "Murphy", "Rogers", "Diaz", "Reyes", "Sanders", "Hayes", "Powell", "Long"
];

const CITIES = [
  "New York, NY",
  "Brooklyn, NY",
  "Queens, NY",
  "Bronx, NY",
  "Staten Island, NY",
  "Boston, MA",
  "Brookline, MA",
  "Newton, MA",
  "Los Angeles, CA",
  "Beverly Hills, CA",
  "Santa Monica, CA",
  "Scarsdale, NY",
  "Larchmont, NY",
  "Mamaroneck, NY",
  "White Plains, NY",
  "Rye, NY",
  "Rye Brook, NY",
  "Harrison, NY",
  "Bronxville, NY",
  "New Rochelle, NY",
  "Chappaqua, NY",
  "Armonk, NY",
  "Mount Kisco, NY",
  "Tarrytown, NY",
  "Sleepy Hollow, NY",
  "Yonkers, NY"
];

const INDUSTRIES = [
  "Education",
  "Technology",
  "Healthcare",
  "Finance",
  "Marketing",
  "Legal",
  "Hospitality",
  "Media",
  "Construction",
  "Public Service"
];

const COLLEGES = [
  "University of Michigan",
  "UCLA",
  "NYU",
  "University of Texas at Austin",
  "Northwestern University",
  "University of Virginia",
  "Vanderbilt University",
  "Indiana University",
  "Emory University",
  "Boston University"
];

const SEASONS = ["Spring", "Summer", "Fall", "Winter"];

const PHOTO_CAPTIONS = [
  "Weekend reunion picnic at camp.",
  "Counselor appreciation circle.",
  "Lake day with the alumnae crew.",
  "Campfire songs and stories.",
  "Cabin photo throwback.",
  "Alumni service day at campus.",
  "Opening day volunteer team.",
  "Sports field friendly tournament.",
  "Arts studio showcase moment.",
  "Sunset over the waterfront."
];

const FORUM_NAMES = [
  "Reunion Planning",
  "Staff Mentorship",
  "Alumnae Career Network",
  "Cabin Throwbacks",
  "Westchester Meetups",
  "Summer Volunteer Squad"
];

const FORUM_POSTS = [
  "Who is available for a planning call this week?",
  "Sharing updates from this month's alumnae meetup.",
  "Would love introductions for members in healthcare.",
  "Posting old photos from my counselor years.",
  "Can we coordinate carpools from Westchester?",
  "Looking for volunteers for the opening weekend."
];

const FEED_MESSAGES = [
  "Community update: registration for reunion weekend is open.",
  "Photo challenge: post your favorite summer memory.",
  "Mentorship spotlight: new pairings launched this month.",
  "Newsletter drop: highlights from alumnae around the country.",
  "Family trees updated with new cross-generational links.",
  "Forum roundtable this Friday for counselors and staff."
];

function envFlag(name, fallback = false) {
  const normalized = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function pick(list, index, salt = 0) {
  return list[(index * 11 + salt * 7) % list.length];
}

function normalizeLabelList(values = []) {
  return uniqueIdList((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()));
}

function isSeedEmail(email = "") {
  return String(email || "").toLowerCase().includes("@seed.pondbridge.local");
}

function uniqueIdList(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function seedPrefixForTenant(slug = "") {
  return `SEED:${String(slug || "").toUpperCase()}:`;
}

function parseArgs(argv = []) {
  const options = {
    slug: "",
    count: 50,
    dryRun: false,
    allowLive: false,
    womenOnly: false,
    withContent: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--allow-live") {
      options.allowLive = true;
      continue;
    }
    if (token === "--women-only") {
      options.womenOnly = true;
      continue;
    }
    if (token === "--with-content") {
      options.withContent = true;
      continue;
    }
    if (token === "--slug") {
      options.slug = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token.startsWith("--slug=")) {
      options.slug = token.split("=").slice(1).join("=").trim().toLowerCase();
      continue;
    }
    if (token === "--count") {
      options.count = Number(argv[i + 1] || 0);
      i += 1;
      continue;
    }
    if (token.startsWith("--count=")) {
      options.count = Number(token.split("=").slice(1).join("="));
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(options.count) || options.count < 1) {
    throw new Error("--count must be a positive integer.");
  }
  options.count = Math.min(Math.trunc(options.count), 1000);

  return options;
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug <tenant-slug> [--count 50] [--allow-live] [--women-only] [--with-content] [--dry-run]"
  );
  console.log("");
  console.log("Examples:");
  console.log(
    "  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug tripplake --count 300 --allow-live --women-only --with-content"
  );
  console.log("  npm --workspace @pondbridge/api run seed:camp-profiles -- --slug demo --count 50");
}

function isHiddenTenant(tenant = {}) {
  const slug = String(tenant.slug || "").trim().toLowerCase();
  const name = String(tenant.name || "").trim();
  return HIDDEN_TENANT_PATTERN.test(slug) || HIDDEN_TENANT_PATTERN.test(name);
}

function isCamperRole(roleAtCamp = "") {
  return /camper/i.test(String(roleAtCamp || ""));
}

function buildCamperYears(index, ageGroupPool = []) {
  const firstYear = 2003 + (index % 9);
  const lastYear = firstYear + 6 + (index % 3);
  const fallbackGroup = "Camper Group";
  const startGroup = ageGroupPool.length ? pick(ageGroupPool, index, 1) : fallbackGroup;
  const endGroup = ageGroupPool.length ? pick(ageGroupPool, index, 2) : fallbackGroup;

  let stints = [];
  if (index % 5 === 0) {
    stints = [
      {
        startYear: String(firstYear),
        endYear: String(firstYear + 2),
        startAgeGroup: startGroup,
        endAgeGroup: startGroup,
        ageGroup: startGroup
      },
      {
        startYear: String(firstYear + 3),
        endYear: String(lastYear),
        startAgeGroup: endGroup,
        endAgeGroup: endGroup,
        ageGroup: endGroup
      }
    ];
  } else {
    stints = [
      {
        startYear: String(firstYear),
        endYear: String(lastYear),
        startAgeGroup: startGroup,
        endAgeGroup: endGroup,
        ageGroup: startGroup
      }
    ];
  }

  return {
    firstYear: stints[0].startYear,
    firstGroup: String(stints[0].startAgeGroup || "").trim(),
    lastYear: stints[stints.length - 1].endYear,
    lastGroup: String(stints[stints.length - 1].endAgeGroup || "").trim(),
    stints
  };
}

function buildStaffYears(index, roleAtCamp = "") {
  const staffRole = !isCamperRole(roleAtCamp);
  const hasStaffYears =
    (staffRole && index % 2 === 0) || (!staffRole && index % 9 === 0);
  if (!hasStaffYears) return { stints: [] };

  const startYear = 2014 + (index % 8);
  const endYear = startYear + (index % 4);

  const stints = [{ startYear: String(startYear), endYear: String(endYear) }];
  if (index % 8 === 0) {
    stints.push({ startYear: String(endYear + 1), endYear: String(endYear + 2) });
  }

  return { stints };
}

function buildProfile(index, tenantSlug, taxonomy = {}, { womenOnly = false } = {}) {
  const rolePool = Array.isArray(taxonomy.rolePool) ? taxonomy.rolePool : [];
  const ageGroupPool = Array.isArray(taxonomy.ageGroupPool) ? taxonomy.ageGroupPool : [];
  const namePool = womenOnly ? WOMEN_FIRST_NAMES : FIRST_NAMES;
  const firstName = pick(namePool, index, 1);
  const lastName = pick(LAST_NAMES, index, 2);
  const cityState = pick(CITIES, index, 3);
  const roleAtCamp = rolePool.length ? pick(rolePool, index, 4) : "Camper";
  const industry = pick(INDUSTRIES, index, 5);
  const college = pick(COLLEGES, index, 6);
  const collegeYear = String(2008 + (index % 15));
  const email = `fake.${tenantSlug}.${String(index).padStart(3, "0")}@seed.pondbridge.local`;
  const nickname = `${firstName}-${String(index).padStart(3, "0")}`;
  const handle = `${firstName}.${lastName}.${index}`.toLowerCase();
  const camperYears = buildCamperYears(index, ageGroupPool);
  const staffYears = buildStaffYears(index, roleAtCamp);
  const canonicalCamperRole =
    rolePool.find((role) => isCamperRole(role)) || (rolePool.includes("Camper") ? "Camper" : "");
  const roles = uniqueIdList([canonicalCamperRole, roleAtCamp, staffYears.stints.length ? "Staff" : ""]);

  return {
    firstName,
    lastName,
    email,
    cityState,
    roleAtCamp,
    industry,
    highSchool: `${cityState.split(",")[0]} High School`,
    colleges: [college],
    collegeYears: [collegeYear],
    currentJobs: [
      {
        role: `${industry} Professional`,
        company: `${lastName} Group`,
        years: "2022-Present"
      }
    ],
    pastJobs: [
      {
        role: "Summer Staff",
        company: `${String(tenantSlug || "").toUpperCase()} Camp`,
        years: "2018-2021"
      }
    ],
    socials: {
      linkedin: `https://www.linkedin.com/in/${handle}`,
      instagram: `https://instagram.com/${handle}`,
      facebook: `https://facebook.com/${handle}`,
      nickname,
      campNickname: nickname,
      roles,
      camperYears,
      staffYears,
      collegeMajors: ["Psychology"]
    },
    bio: `Fictional seed profile ${index} for tenant ${tenantSlug}. Alumni community member and camp supporter.`
  };
}

async function listActiveTenantSlugs() {
  const tenants = await TenantModel.find(
    { status: "active" },
    { sort: { slug: 1 }, select: ["slug", "name", "status", "onboardingStatus"] }
  );
  return tenants.map((tenant) => ({
    slug: String(tenant.slug || ""),
    name: String(tenant.name || ""),
    onboardingStatus: String(tenant.onboardingStatus || "")
  }));
}

async function deriveCampTaxonomy(tenant = {}) {
  const content = tenant?.content && typeof tenant.content === "object" ? tenant.content : {};
  const configuredAgeGroups = normalizeLabelList(content.ageGroups || []);
  const configuredStaffRoles = normalizeLabelList(content.staffRoles || []);

  const profiles = await ProfileModel.find(
    tenant._id,
    {},
    { select: ["emails", "roleAtCamp", "socials"], limit: 5000 }
  );

  const observedRoles = new Set();
  const observedAgeGroups = new Set();

  for (const profile of profiles) {
    const emails = Array.isArray(profile?.emails) ? profile.emails : [];
    if (emails.some((email) => isSeedEmail(email))) continue;

    const roleAtCamp = String(profile?.roleAtCamp || "").trim();
    if (roleAtCamp) observedRoles.add(roleAtCamp);

    const socials = profile?.socials && typeof profile.socials === "object" ? profile.socials : {};
    if (Array.isArray(socials.roles)) {
      for (const role of socials.roles) {
        const normalized = String(role || "").trim();
        if (normalized) observedRoles.add(normalized);
      }
    }

    const camperYears =
      socials.camperYears && typeof socials.camperYears === "object" ? socials.camperYears : {};
    const edgeGroups = [camperYears.firstGroup, camperYears.lastGroup];
    for (const group of edgeGroups) {
      const normalized = String(group || "").trim();
      if (normalized) observedAgeGroups.add(normalized);
    }

    const stints = Array.isArray(camperYears.stints) ? camperYears.stints : [];
    for (const stint of stints) {
      const labels = [stint?.ageGroup, stint?.startAgeGroup, stint?.endAgeGroup];
      for (const label of labels) {
        const normalized = String(label || "").trim();
        if (normalized) observedAgeGroups.add(normalized);
      }
    }
  }

  const rolePool = normalizeLabelList([...configuredStaffRoles, ...Array.from(observedRoles)]);
  const ageGroupPool = normalizeLabelList([...configuredAgeGroups, ...Array.from(observedAgeGroups)]);

  return {
    rolePool: rolePool.length ? rolePool : ["Camper"],
    ageGroupPool: ageGroupPool.length ? ageGroupPool : ["Camper Group"],
    configuredRoleCount: configuredStaffRoles.length,
    configuredAgeGroupCount: configuredAgeGroups.length,
    observedRoleCount: observedRoles.size,
    observedAgeGroupCount: observedAgeGroups.size
  };
}

async function purgeByPrefix({ model, tenantId, textField, prefix }) {
  const rows = await model.find(tenantId, { [textField]: { $ilike: `${prefix}%` } }, { limit: 5000 });
  for (const row of rows) {
    await model.delete(row._id);
  }
  return rows.length;
}

function asMemberRecord(profile = {}, user = {}) {
  const userId = String(user?._id || "").trim();
  const profileId = String(profile?._id || "").trim();
  const firstName = String(profile?.firstName || "").trim();
  const lastName = String(profile?.lastName || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Member";
  return {
    userId,
    profileId,
    firstName,
    lastName,
    fullName,
    email: String(user?.email || "").trim()
  };
}

function uniqueMembers(members = []) {
  const seenUsers = new Set();
  return members.filter((member) => {
    const key = String(member?.userId || "").trim();
    if (!key || seenUsers.has(key)) return false;
    seenUsers.add(key);
    return true;
  });
}

function buildFamilyTreeMembers(selected = []) {
  const members = selected.filter((entry) => entry?.profileId);
  if (members.length < 2) return [];

  const relationships = new Map(members.map((entry) => [entry.profileId, []]));
  const ids = members.map((entry) => entry.profileId);

  const add = (fromProfileId, toProfileId, type) => {
    if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) return;
    const existing = relationships.get(fromProfileId) || [];
    existing.push({ toProfileId, type });
    relationships.set(fromProfileId, existing);
  };

  if (ids[0] && ids[1]) {
    add(ids[0], ids[1], "spouse");
    add(ids[1], ids[0], "spouse");
  }
  if (ids[2]) {
    add(ids[0], ids[2], "parent");
    add(ids[1], ids[2], "parent");
    add(ids[2], ids[0], "child");
    add(ids[2], ids[1], "child");
  }
  if (ids[3]) {
    add(ids[2], ids[3], "sibling");
    add(ids[3], ids[2], "sibling");
  }
  if (ids[4]) {
    add(ids[4], ids[2], "cousin");
    add(ids[2], ids[4], "cousin");
  }

  return members.map((entry) => ({
    profileId: entry.profileId,
    relationships: relationships.get(entry.profileId) || []
  }));
}

async function seedSupplementalContent({ tenant, members, prefix }) {
  if (!members.length) {
    return {
      purged: {},
      created: {},
      note: "No members found for content seeding."
    };
  }

  const purged = {
    newsletters: 0,
    photos: 0,
    familyTrees: 0,
    forums: 0,
    forumPosts: 0,
    activityItems: 0
  };

  purged.newsletters = await purgeByPrefix({
    model: NewsletterModel,
    tenantId: tenant._id,
    textField: "title",
    prefix
  });
  purged.photos = await purgeByPrefix({
    model: PhotoModel,
    tenantId: tenant._id,
    textField: "caption",
    prefix
  });
  purged.familyTrees = await purgeByPrefix({
    model: FamilyTreeModel,
    tenantId: tenant._id,
    textField: "name",
    prefix
  });
  purged.activityItems = await purgeByPrefix({
    model: ActivityItemModel,
    tenantId: tenant._id,
    textField: "message",
    prefix
  });

  const oldForums = await ForumModel.find(
    tenant._id,
    { name: { $ilike: `${prefix}%` } },
    { limit: 1000 }
  );
  for (const forum of oldForums) {
    const postRows = await ForumPostModel.find(tenant._id, { forumId: forum._id }, { limit: 5000 });
    purged.forumPosts += postRows.length;
    await ForumPostModel.deleteMany(tenant._id, { forumId: forum._id });
    await ForumModel.delete(forum._id);
    purged.forums += 1;
  }

  const created = {
    newsletters: 0,
    photos: 0,
    familyTrees: 0,
    forums: 0,
    forumPosts: 0,
    activityItems: 0
  };

  for (let idx = 0; idx < 10; idx += 1) {
    const season = SEASONS[idx % SEASONS.length];
    const year = 2021 + idx;
    await NewsletterModel.create({
      tenantId: tenant._id,
      title: `${prefix}${season} ${year} Newsletter`,
      season,
      year,
      pdfName: `${tenant.slug}-${season}-${year}.pdf`,
      pdfMimeType: "application/pdf",
      pdfData: null,
      coverImageName: "",
      coverImageMimeType: "",
      coverImageData: null
    });
    created.newsletters += 1;
  }

  for (let idx = 1; idx <= 48; idx += 1) {
    const owner = pick(members, idx, 1);
    const likeCount = (idx % 5) + 1;
    const likes = [];
    for (let j = 0; j < likeCount; j += 1) {
      likes.push(pick(members, idx + j, 2).userId);
    }

    const commentCount = idx % 3;
    const comments = [];
    for (let k = 0; k < commentCount; k += 1) {
      const author = pick(members, idx + k, 3);
      comments.push({
        authorId: author.userId,
        authorName: author.fullName,
        authorAvatarUrl: "",
        text: `${prefix}${pick(FEED_MESSAGES, idx + k, 1)}`,
        commentMentions: []
      });
    }

    await PhotoModel.create({
      tenantId: tenant._id,
      ownerId: owner.userId,
      ownerName: owner.fullName,
      imageUrl: `https://picsum.photos/seed/${tenant.slug}-seed-photo-${idx}/1400/1000`,
      thumbUrl: `https://picsum.photos/seed/${tenant.slug}-seed-photo-${idx}/500/350`,
      caption: `${prefix}${pick(PHOTO_CAPTIONS, idx, 2)}`,
      captionMentions: [],
      likes: uniqueIdList(likes),
      comments
    });
    created.photos += 1;
  }

  for (let idx = 0; idx < 12; idx += 1) {
    const cursor = idx * 4;
    const selected = [
      pick(members, cursor + 1, 1),
      pick(members, cursor + 2, 1),
      pick(members, cursor + 3, 1),
      pick(members, cursor + 4, 1),
      pick(members, cursor + 5, 1)
    ];
    const treeMembers = buildFamilyTreeMembers(uniqueMembers(selected));
    if (treeMembers.length < 2) continue;

    const creator = selected[0] || members[0];
    await FamilyTreeModel.create({
      tenantId: tenant._id,
      name: `${prefix}Family Tree ${idx + 1}`,
      createdByUserId: creator.userId,
      members: treeMembers
    });
    created.familyTrees += 1;
  }

  for (let idx = 0; idx < FORUM_NAMES.length; idx += 1) {
    const creator = pick(members, idx + 1, 1);
    const forumMembers = uniqueIdList([
      creator.userId,
      pick(members, idx + 2, 2).userId,
      pick(members, idx + 3, 2).userId,
      pick(members, idx + 4, 2).userId,
      pick(members, idx + 5, 2).userId,
      pick(members, idx + 6, 2).userId
    ]);

    const forum = await ForumModel.create({
      tenantId: tenant._id,
      name: `${prefix}${FORUM_NAMES[idx]}`,
      createdBy: creator.userId,
      creatorId: creator.userId,
      memberIds: forumMembers,
      moderators: [creator.userId],
      postsCount: 0,
      lastActivityAt: new Date()
    });
    created.forums += 1;

    let forumPostCount = 0;
    for (let postIdx = 0; postIdx < 6; postIdx += 1) {
      const authorId = forumMembers[postIdx % forumMembers.length] || creator.userId;
      await ForumPostModel.create({
        tenantId: tenant._id,
        forumId: forum._id,
        authorId,
        kind: "text",
        text: `${prefix}${pick(FORUM_POSTS, postIdx + idx, 3)}`,
        media: null
      });
      forumPostCount += 1;
      created.forumPosts += 1;
    }

    await ForumModel.update(forum._id, {
      postsCount: forumPostCount,
      lastActivityAt: new Date()
    });
  }

  for (let idx = 0; idx < 24; idx += 1) {
    const actor = pick(members, idx + 1, 4);
    const pinned = idx === 0;
    await ActivityItemModel.create({
      tenantId: tenant._id,
      actorUserId: actor.userId,
      actor: {
        id: actor.userId,
        name: actor.fullName
      },
      type: "announcement.post",
      message: `${prefix}${pick(FEED_MESSAGES, idx, 1)}`,
      target: {
        href: idx % 2 === 0 ? "/photo-stream" : "/forums",
        label: idx % 2 === 0 ? "Photo Stream" : "Forums"
      },
      pinned,
      pinnedAt: pinned ? new Date() : null,
      ts: new Date()
    });
    created.activityItems += 1;
  }

  return {
    purged,
    created
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!args.slug) {
    printUsage();
    throw new Error("Missing required argument: --slug <tenant-slug>");
  }

  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const allowProdSeed = envFlag("PONDBRIDGE_ALLOW_PROD_SEED", false);
  if (nodeEnv === "production" && !allowProdSeed) {
    throw new Error(
      "Refusing to run seed in production without PONDBRIDGE_ALLOW_PROD_SEED=1."
    );
  }

  await connectToDatabase();

  const tenant = await TenantModel.findBySlug(args.slug);
  if (!tenant) {
    const activeTenants = await listActiveTenantSlugs();
    const knownSlugs = activeTenants.map((item) => item.slug).filter(Boolean).join(", ");
    throw new Error(
      `Tenant "${args.slug}" not found. Active tenant slugs: ${knownSlugs || "(none)"}`
    );
  }

  if (String(tenant.status || "").toLowerCase() !== "active") {
    throw new Error(
      `Tenant "${tenant.slug}" is not active (status=${tenant.status || "unknown"}).`
    );
  }

  const hiddenTenant = isHiddenTenant(tenant);
  if (!hiddenTenant && !args.allowLive) {
    throw new Error(
      `Refusing to seed non-demo tenant "${tenant.slug}" without --allow-live.`
    );
  }

  const taxonomy = await deriveCampTaxonomy(tenant);

  if (args.dryRun) {
    console.log("[seed:camp-profiles] Dry run complete.");
    console.log(
      `[seed:camp-profiles] Would upsert ${args.count} profiles into tenant "${tenant.slug}" (${tenant._id}).`
    );
    console.log(
      `[seed:camp-profiles] womenOnly=${args.womenOnly ? "true" : "false"}, withContent=${
        args.withContent ? "true" : "false"
      }`
    );
    console.log(
      `[seed:camp-profiles] taxonomy roles=${taxonomy.rolePool.length} ageGroups=${taxonomy.ageGroupPool.length}`
    );
    return;
  }

  let createdUsers = 0;
  let updatedUsers = 0;
  let createdProfiles = 0;
  let updatedProfiles = 0;

  const seedMembers = [];
  const defaultPasswordHash = await hashPassword("Pondbridge123!");

  for (let index = 1; index <= args.count; index += 1) {
    const fake = buildProfile(index, tenant.slug, taxonomy, {
      womenOnly: args.womenOnly
    });

    let user = await UserModel.findOne(tenant._id, { email: fake.email });
    if (!user) {
      user = await UserModel.create({
        tenantId: tenant._id,
        email: fake.email,
        passwordHash: defaultPasswordHash,
        roles: ["user"],
        status: "active"
      });
      createdUsers += 1;
    } else {
      user = await UserModel.update(user._id, {
        passwordHash: user.passwordHash || defaultPasswordHash,
        roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : ["user"],
        status: "active"
      });
      updatedUsers += 1;
    }

    const profilePayload = {
      tenantId: tenant._id,
      userId: user._id,
      firstName: fake.firstName,
      lastName: fake.lastName,
      emails: [fake.email],
      phones: [
        `555-${String(200 + index).padStart(3, "0")}-${String(4000 + index).padStart(4, "0")}`
      ],
      cityState: fake.cityState,
      roleAtCamp: fake.roleAtCamp,
      highSchool: fake.highSchool,
      colleges: fake.colleges,
      collegeYears: fake.collegeYears,
      currentJobs: fake.currentJobs,
      pastJobs: fake.pastJobs,
      industry: fake.industry,
      socials: fake.socials,
      avatarUrl: "",
      bio: fake.bio,
      status: "active"
    };

    const existingProfile = await ProfileModel.findByUserId(tenant._id, user._id);
    let profile = null;
    if (!existingProfile) {
      profile = await ProfileModel.create(profilePayload);
      createdProfiles += 1;
    } else {
      profile = await ProfileModel.update(existingProfile._id, profilePayload);
      updatedProfiles += 1;
    }

    if (String(user.profileId || "") !== String(profile._id || "")) {
      await UserModel.update(user._id, { profileId: profile._id });
    }

    seedMembers.push(asMemberRecord(profile, user));
  }

  let contentSummary = null;
  if (args.withContent) {
    contentSummary = await seedSupplementalContent({
      tenant,
      members: uniqueMembers(seedMembers),
      prefix: seedPrefixForTenant(tenant.slug)
    });
  }

  console.log("[seed:camp-profiles] Complete.");
  console.log(`[seed:camp-profiles] Tenant: ${tenant.slug} (${tenant._id})`);
  console.log(`[seed:camp-profiles] Requested count: ${args.count}`);
  console.log(`[seed:camp-profiles] womenOnly: ${args.womenOnly ? "true" : "false"}`);
  console.log(
    `[seed:camp-profiles] Taxonomy pools: roles=${taxonomy.rolePool.length} ageGroups=${taxonomy.ageGroupPool.length} (configured roles=${taxonomy.configuredRoleCount}, configured ageGroups=${taxonomy.configuredAgeGroupCount})`
  );
  console.log(`[seed:camp-profiles] Users created/updated: ${createdUsers}/${updatedUsers}`);
  console.log(`[seed:camp-profiles] Profiles created/updated: ${createdProfiles}/${updatedProfiles}`);

  if (contentSummary) {
    console.log("[seed:camp-profiles] Supplemental content summary:");
    console.log(JSON.stringify(contentSummary, null, 2));
  }
}

run().catch((error) => {
  console.error("[seed:camp-profiles] Error:", error?.message || error);
  process.exit(1);
});
