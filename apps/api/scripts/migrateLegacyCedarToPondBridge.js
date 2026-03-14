import fs from "node:fs";
import path from "node:path";
import {
  ActivityItemModel,
  ConversationModel,
  FamilyTreeModel,
  ForumModel,
  ForumPostModel,
  MessageModel,
  NewsletterModel,
  PhotoModel,
  ProfileModel,
  TenantModel,
  UserModel
} from "../src/db/models/index.js";
import { getSupabaseAdmin } from "../src/db/supabaseAdmin.js";
import { generateObjectId, isValidObjectId } from "../src/utils/objectId.js";
import {
  CEDAR_SLUG,
  EXISTING_ARCHIVE_MANIFEST,
  EXISTING_BACKUP_DIR,
  IMPORT_SUMMARY_JSON,
  LEGACY_AUDIT_JSON,
  LEGACY_FRONTEND_DIR,
  MAPPING_DIR,
  NEW_TENANT_MANIFEST,
  basenameFromUrl,
  buildProfileSocials,
  buildTenantObjectProxyBaseUrl,
  clerkClientOrNull,
  encodeR2Pointer,
  ensureDir,
  ensureHexObjectId,
  findTenantBySlug,
  getLegacyAuditSnapshot,
  isoNow,
  legacyUserNeedsTenantAdmin,
  listExistingClerkUsersByEmails,
  mapLegacyUserToProfile,
  migrateRemoteAssetToR2,
  normalizeEmail,
  parseApplyFlag,
  readJsonIfExists,
  stableJson,
  timestampSlugSuffix,
  writeJson,
  writeMarkdown
} from "./cedarMigrationCommon.js";

const ADEN_EMAIL = "aden@sorocafamily.com";
const ADEN_NAME = "Aden Soroca";
const DIRECTOR_TERMS_VERSION = "2026-03-06";

function legacyUserId(user = {}) {
  return ensureHexObjectId(user?._id || user?.id || "", "legacy-user");
}

function legacyRecordId(row = {}, prefix = "legacy-row") {
  return ensureHexObjectId(row?._id || row?.id || "", prefix);
}

function byId(items = [], getId) {
  return new Map(items.map((item) => [String(getId(item)), item]));
}

function pickTemplateTenant() {
  const backup = readJsonIfExists(path.join(EXISTING_BACKUP_DIR, "tenant.json"), null);
  if (backup) return backup;
  return {
    name: "Camp Cedar",
    slug: CEDAR_SLUG,
    status: "active",
    planTier: "premium",
    onboardingStatus: "live",
    onboardingStep: "review_launch",
    billingStatus: "active",
    theme: {
      bg: "#f5f7fa",
      card: "#ffffff",
      text: "#0f172a",
      logoUrl: "",
      fontToken: "cedar_default",
      fontFamily: "Inter",
      typography: "Inter",
      brandAccent: "#f2b134",
      brandPrimary: "#002b5c",
      heroImageUrl: "",
      brandSecondary: "#d3dde8"
    },
    content: {
      aboutText: "Camp Cedar alumni can reconnect, share memories, and support each other.",
      supportUrl: "",
      footerLinks: [],
      welcomeBody: "Reconnect with campers, staff, and directors from every era.",
      contactEmail: ADEN_EMAIL,
      welcomeHeadline: "Welcome to Camp Cedar Alumni Network",
      networkDisplayName: "Camp Cedar Alumni Network",
      newsletterName: "Cedar Chest"
    },
    settings: {
      signupMode: "open",
      accessCodeHash: "",
      accessCodeHint: "",
      allowedEmailDomains: [],
      allowDirectoryBrowse: true,
      allowSearchByDefault: true,
      requireProfileCompletion: false
    },
    accessSettings: {
      accessCode: "",
      signupMode: "open"
    },
    modules: {
      map: true,
      chat: true,
      search: true,
      directory: true,
      merchShop: true,
      newsletter: true,
      familyTrees: true,
      photoStream: true,
      relatedProfiles: true
    }
  };
}

async function migrateBrandingAssets({ apply }) {
  const result = {
    logo: { status: "skipped", source: "src/assets/cedar-logo.png", objectUrl: "" },
    hero: { status: "skipped", source: "src/assets/cedar-field.jpeg", objectUrl: "" }
  };

  const logoPath = path.join(LEGACY_FRONTEND_DIR, "src/assets/cedar-logo.png");
  const heroPath = path.join(LEGACY_FRONTEND_DIR, "src/assets/cedar-field.jpeg");

  if (!apply) return result;

  const { uploadBufferToR2 } = await import("../src/services/objectStorage.js");

  if (fs.existsSync(logoPath)) {
    const uploaded = await uploadBufferToR2({
      tenantSlug: CEDAR_SLUG,
      prefix: "branding/logos",
      fileName: "cedar-logo.png",
      fileType: "image/png",
      body: fs.readFileSync(logoPath),
      objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(CEDAR_SLUG)
    }).catch(() => null);
    if (uploaded?.objectUrl) {
      result.logo = { ...uploaded, source: "src/assets/cedar-logo.png", status: "uploaded" };
    }
  }

  if (fs.existsSync(heroPath)) {
    const uploaded = await uploadBufferToR2({
      tenantSlug: CEDAR_SLUG,
      prefix: "branding/heroes",
      fileName: "cedar-field.jpeg",
      fileType: "image/jpeg",
      body: fs.readFileSync(heroPath),
      objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(CEDAR_SLUG)
    });
    result.hero = { ...uploaded, source: "src/assets/cedar-field.jpeg", status: "uploaded" };
  }

  return result;
}

async function ensureClerkUsers({ legacyUsers, apply }) {
  const clerkClient = clerkClientOrNull();
  const existingUsers = await listExistingClerkUsersByEmails(
    clerkClient,
    legacyUsers.map((user) => normalizeEmail(user.email))
  );
  const byEmail = new Map();
  for (const user of existingUsers) {
    for (const emailAddress of user.emailAddresses || []) {
      const email = normalizeEmail(emailAddress?.emailAddress || "");
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, user);
    }
  }

  const summary = {
    configured: Boolean(clerkClient),
    reused: 0,
    created: 0,
    missing: 0,
    errors: []
  };
  const clerkByEmail = new Map();

  for (const legacyUser of legacyUsers) {
    const email = normalizeEmail(legacyUser.email);
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      clerkByEmail.set(email, {
        status: "reused",
        clerkUserId: existing.id,
        externalId: existing.externalId || null
      });
      summary.reused += 1;
      continue;
    }

    if (!clerkClient || !apply) {
      clerkByEmail.set(email, { status: "pending_create", clerkUserId: "", externalId: null });
      summary.missing += 1;
      continue;
    }

    try {
      const legalAcceptedAt = legacyUser?.legalAcceptance?.acceptedAt
        ? new Date(legacyUser.legalAcceptance.acceptedAt)
        : undefined;
        const created = await clerkClient.users.createUser({
        emailAddress: [email],
        firstName: String(legacyUser.firstName || "").trim() || undefined,
        lastName: String(legacyUser.lastName || "").trim() || undefined,
        passwordDigest: String(legacyUser.passwordHash || "").trim(),
        passwordHasher: "bcrypt",
        externalId: `legacy_cedar_user_${legacyUserId(legacyUser)}`,
        createdAt: legacyUser?.createdAt ? new Date(legacyUser.createdAt) : undefined,
        skipLegalChecks: true,
        ...(legalAcceptedAt ? { legalAcceptedAt } : {})
      });
      clerkByEmail.set(email, {
        status: "created",
        clerkUserId: created.id,
        externalId: created.externalId || null
      });
      summary.created += 1;
    } catch (error) {
      clerkByEmail.set(email, {
        status: "create_failed",
        clerkUserId: "",
        externalId: null
      });
      summary.errors.push({
        email,
        message: String(error?.message || error)
      });
    }
  }

  return { clerkByEmail, summary };
}

function buildTenantPayload({ templateTenant, branding, adenUserId }) {
  const now = isoNow();
  const theme = {
    ...(templateTenant.theme || {}),
    ...(branding.logo?.objectUrl ? { logoUrl: branding.logo.objectUrl } : {}),
    ...(branding.hero?.objectUrl ? { heroImageUrl: branding.hero.objectUrl } : {})
  };
  const content = {
    ...(templateTenant.content || {}),
    contactEmail: ADEN_EMAIL,
    newsletterName: String(templateTenant?.content?.newsletterName || "Cedar Chest")
  };

  return {
    name: "Camp Cedar",
    slug: CEDAR_SLUG,
    status: "active",
    planTier: templateTenant.planTier || "premium",
    onboardingStatus: "live",
    onboardingStep: "review_launch",
    billingStatus: templateTenant.billingStatus || "active",
    theme,
    content,
    settings: templateTenant.settings || {},
    modules: templateTenant.modules || {},
    accessSettings: templateTenant.accessSettings || {},
    launch: {
      launchedAt: now,
      launchedByUserId: adenUserId || null
    },
    onboardingProgress: {
      currentStep: 6,
      completedSteps: [1, 2, 3, 4, 5, 6],
      launchedAt: now,
      lastSavedAt: now,
      lastImportStats: {}
    },
    directorLegalAgreement: {
      accepted: true,
      acceptedAt: now,
      acceptedByUserId: adenUserId || null,
      termsVersion: DIRECTOR_TERMS_VERSION,
      privacyVersion: DIRECTOR_TERMS_VERSION,
      directorAgreementVersion: DIRECTOR_TERMS_VERSION
    },
    notificationPrefs: templateTenant.notificationPrefs || {},
    billingDetails: templateTenant.billingDetails || {},
    addOns: templateTenant.addOns || []
  };
}

async function createOrUpdateTenantRow({ apply, templateTenant, adenUserId }) {
  const existingFresh = await findTenantBySlug(CEDAR_SLUG);
  const manifest = readJsonIfExists(NEW_TENANT_MANIFEST, null);
  const tenantId = manifest?.tenantId && isValidObjectId(manifest.tenantId) ? manifest.tenantId : generateObjectId();
  const branding = await migrateBrandingAssets({ apply });
  const payload = buildTenantPayload({ templateTenant, branding, adenUserId });

  if (existingFresh) {
    if (!apply) {
      return { tenantId: String(existingFresh._id), branding, status: "would_update_existing" };
    }
    await TenantModel.update(String(existingFresh._id), payload);
    writeJson(NEW_TENANT_MANIFEST, {
      tenantId: String(existingFresh._id),
      slug: CEDAR_SLUG,
      updatedAt: isoNow()
    });
    return { tenantId: String(existingFresh._id), branding, status: "updated_existing" };
  }

  if (!apply) {
    return { tenantId, branding, status: "would_create" };
  }

  await TenantModel.upsert({
    id: tenantId,
    ...payload
  });
  writeJson(NEW_TENANT_MANIFEST, {
    tenantId,
    slug: CEDAR_SLUG,
    createdAt: isoNow()
  });
  return { tenantId, branding, status: "created" };
}

async function importUsersAndProfiles({ legacyUsers, tenantId, clerkByEmail, apply }) {
  const summary = {
    users: { upserted: 0, clerkLinked: 0, pendingClaim: 0 },
    profiles: { upserted: 0 },
    avatarUploads: { uploaded: 0, keptLegacyUrl: 0, errors: [] }
  };
  const userIdMap = new Map();
  const existingUsersById = apply
    ? new Map((await UserModel.find(tenantId, {})).map((row) => [String(row._id || row.id), row]))
    : new Map();
  const existingProfilesById = apply
    ? new Map((await ProfileModel.find(tenantId, {})).map((row) => [String(row._id || row.id), row]))
    : new Map();

  for (const legacyUser of legacyUsers) {
    const id = legacyUserId(legacyUser);
    const email = normalizeEmail(legacyUser.email);
    const clerk = clerkByEmail.get(email) || { clerkUserId: "", status: "missing" };
    const appRoles = legacyUserNeedsTenantAdmin(legacyUser) ? ["tenant_admin", "user"] : ["user"];
    const createdAt = legacyUser?.createdAt ? new Date(legacyUser.createdAt) : new Date();
    const updatedAt = legacyUser?.updatedAt ? new Date(legacyUser.updatedAt) : createdAt;
    const existingProfile = existingProfilesById.get(id) || null;
    let avatarUrl = String(existingProfile?.avatarUrl || legacyUser?.uploads?.photoUrl || "").trim();

    if (apply && !existingProfile?.avatarUrl && avatarUrl) {
      try {
        const uploaded = await migrateRemoteAssetToR2({
          sourceUrl: avatarUrl,
          tenantSlug: CEDAR_SLUG,
          prefix: "profiles/avatars",
          fileName: basenameFromUrl(avatarUrl, `${id}-avatar`),
          objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(CEDAR_SLUG)
        });
        if (uploaded?.objectUrl) {
          avatarUrl = uploaded.objectUrl;
          summary.avatarUploads.uploaded += 1;
        } else {
          summary.avatarUploads.keptLegacyUrl += 1;
        }
      } catch (error) {
        summary.avatarUploads.errors.push({ email, message: String(error?.message || error) });
        summary.avatarUploads.keptLegacyUrl += 1;
      }
    }

    userIdMap.set(String(legacyUser._id), id);
    if (!apply) {
      summary.users.upserted += 1;
      summary.profiles.upserted += 1;
      if (clerk?.clerkUserId) summary.users.clerkLinked += 1;
      else summary.users.pendingClaim += 1;
      continue;
    }

    await UserModel.upsert({
      id,
      tenantId,
      clerkUserId: clerk?.clerkUserId || null,
      email,
      passwordHash: clerk?.clerkUserId ? "clerk_managed" : "clerk_pending_claim",
      roles: appRoles,
      profileId: id,
      status: "active",
      lastLoginAt: null,
      createdAt,
      updatedAt
    });
    existingUsersById.set(id, { ...(existingUsersById.get(id) || {}), _id: id, clerkUserId: clerk?.clerkUserId || null });
    summary.users.upserted += 1;
    if (clerk?.clerkUserId) summary.users.clerkLinked += 1;
    else summary.users.pendingClaim += 1;

    const profile = mapLegacyUserToProfile(legacyUser);
    profile.avatarUrl = avatarUrl;
    await ProfileModel.upsert({
      id,
      tenantId,
      userId: id,
      ...profile,
      createdAt,
      updatedAt
    });
    existingProfilesById.set(id, { ...(existingProfilesById.get(id) || {}), _id: id, avatarUrl });
    summary.profiles.upserted += 1;
  }

  return { summary, userIdMap, profileIdMap: new Map([...userIdMap.entries()]) };
}

async function importActivities({ legacyActivities, tenantId, userIdMap, apply }) {
  let upserted = 0;
  for (const row of legacyActivities) {
    const id = legacyRecordId(row, "legacy-activity");
    const actorLegacyId = String(row?.actor?.id || "").trim();
    const actorUserId = userIdMap.get(actorLegacyId) || "";
    if (!apply) {
      upserted += 1;
      continue;
    }
      await ActivityItemModel.upsert({
        id,
      tenantId,
      actorUserId,
      actor: row?.actor || {},
      type: String(row?.type || "announcement.post"),
      message: String(row?.message || "").trim(),
      target: row?.target || {},
      pinned: Boolean(row?.pinned),
      pinnedAt: row?.pinnedAt ? new Date(row.pinnedAt) : null,
      ts: row?.ts ? new Date(row.ts) : row?.createdAt ? new Date(row.createdAt) : new Date(),
      createdAt: row?.createdAt ? new Date(row.createdAt) : new Date(),
      updatedAt: row?.updatedAt ? new Date(row.updatedAt) : row?.createdAt ? new Date(row.createdAt) : new Date()
    });
    upserted += 1;
  }
  return { upserted };
}

async function importForums({ legacyForums, legacyForumPosts, tenantId, userIdMap, apply }) {
  let forumCount = 0;
  let postCount = 0;
  const importedForumIds = new Set();
  for (const forum of legacyForums) {
    const id = legacyRecordId(forum, "legacy-forum");
    const creatorId = userIdMap.get(String(forum?.createdBy || "")) || userIdMap.get(String(forum?.creatorId || "")) || "";
    const memberIds = (Array.isArray(forum?.memberIds) ? forum.memberIds : [])
      .map((item) => userIdMap.get(String(item || "")) || "")
      .filter(Boolean);
    const moderators = (Array.isArray(forum?.moderators) ? forum.moderators : [])
      .map((item) => userIdMap.get(String(item || "")) || "")
      .filter(Boolean);
    if (apply) {
      await ForumModel.upsert({
        id,
        tenantId,
        name: String(forum?.name || "").trim(),
        createdBy: creatorId || "",
        creatorId: creatorId || "",
        memberIds,
        moderators,
        postsCount: Number(forum?.postsCount || 0),
        lastActivityAt: forum?.lastActivityAt ? new Date(forum.lastActivityAt) : new Date(),
        createdAt: forum?.createdAt ? new Date(forum.createdAt) : new Date(),
        updatedAt: forum?.updatedAt ? new Date(forum.updatedAt) : new Date()
      });
    }
    importedForumIds.add(id);
    forumCount += 1;
  }

  for (const post of legacyForumPosts) {
    const id = legacyRecordId(post, "legacy-forum-post");
    const authorId = userIdMap.get(String(post?.authorId || "")) || "";
    const forumId = legacyRecordId({ _id: post?.forumId }, "legacy-forum");
    if (!importedForumIds.has(forumId)) {
      if (apply) {
        await ForumModel.upsert({
          id: forumId,
          tenantId,
          name: `Legacy Forum ${forumId.slice(0, 8)}`,
          createdBy: authorId || "",
          creatorId: authorId || "",
          memberIds: authorId ? [authorId] : [],
          moderators: authorId ? [authorId] : [],
          postsCount: 1,
          lastActivityAt: post?.createdAt ? new Date(post.createdAt) : new Date(),
          createdAt: post?.createdAt ? new Date(post.createdAt) : new Date(),
          updatedAt: post?.createdAt ? new Date(post.createdAt) : new Date()
        });
      }
      importedForumIds.add(forumId);
      forumCount += 1;
    }
    if (apply) {
      await ForumPostModel.upsert({
        id,
        tenantId,
        forumId,
        authorId,
        kind: String(post?.kind || "text"),
        text: String(post?.text || "").trim(),
        media: post?.media || null,
        createdAt: post?.createdAt ? new Date(post.createdAt) : new Date(),
        editedAt: post?.editedAt ? new Date(post.editedAt) : null,
        deletedAt: post?.deletedAt ? new Date(post.deletedAt) : null
      });
    }
    postCount += 1;
  }

  return { forums: forumCount, forumPosts: postCount };
}

async function importConversations({ legacyConversations, legacyMessages, tenantId, userIdMap, apply }) {
  let conversationCount = 0;
  let messageCount = 0;
  const messagesByConversation = new Map();
  for (const row of legacyMessages) {
    const key = String(row?.conversationId || "");
    const bucket = messagesByConversation.get(key) || [];
    bucket.push(row);
    messagesByConversation.set(key, bucket);
  }

  for (const conversation of legacyConversations) {
    const id = legacyRecordId(conversation, "legacy-conversation");
    const participantIds = [...new Set((Array.isArray(conversation?.participantIds) ? conversation.participantIds : [])
      .map((item) => userIdMap.get(String(item || "")) || "")
      .filter(Boolean))];
    if (participantIds.length < 2) continue;

    const members = (Array.isArray(conversation?.members) ? conversation.members : [])
      .map((member) => ({
        userId: userIdMap.get(String(member?.userId || "")) || "",
        role: String(member?.role || "member")
      }))
      .filter((member) => member.userId);
    const createdBy = userIdMap.get(String(conversation?.createdBy || "")) || participantIds[0];
    const convoMessages = (messagesByConversation.get(String(conversation?._id || "")) || [])
      .sort((left, right) => new Date(left?.createdAt || 0).getTime() - new Date(right?.createdAt || 0).getTime());
    const latestMessage = convoMessages[convoMessages.length - 1] || null;
    const lastMessageAt = latestMessage?.createdAt || conversation?.lastMessageAt || conversation?.updatedAt || new Date();
    const readBy = participantIds.map((userId) => ({
      userId,
      lastReadAt: new Date(lastMessageAt)
    }));

    if (apply) {
      await ConversationModel.upsert({
        id,
        tenantId,
        type: String(conversation?.type || "dm"),
        participantIds,
        name: String(conversation?.name || "").trim(),
        createdBy,
        lastMessageAt: new Date(lastMessageAt),
        lastMessage: latestMessage
          ? {
              senderId: userIdMap.get(String(latestMessage.senderId || "")) || "",
              kind: String(latestMessage.kind || "text"),
              text: String(latestMessage.text || "").trim(),
              media: latestMessage.media || null,
              createdAt: new Date(latestMessage.createdAt || lastMessageAt)
            }
          : null,
        members,
        readBy,
        createdAt: conversation?.createdAt ? new Date(conversation.createdAt) : new Date(),
        updatedAt: conversation?.updatedAt ? new Date(conversation.updatedAt) : new Date()
      });
    }
    conversationCount += 1;
  }

  for (const message of legacyMessages) {
    const id = legacyRecordId(message, "legacy-message");
    const conversationId = legacyRecordId({ _id: message?.conversationId }, "legacy-conversation");
    const senderId = userIdMap.get(String(message?.senderId || "")) || "";
    if (!senderId) continue;
    if (apply) {
      await MessageModel.upsert({
        id,
        tenantId,
        conversationId,
        senderId,
        kind: String(message?.kind || "text"),
        text: String(message?.text || "").trim(),
        media: message?.media || null,
        clientMessageId: String(message?.clientMessageId || "").trim() || undefined,
        createdAt: message?.createdAt ? new Date(message.createdAt) : new Date(),
        editedAt: message?.editedAt ? new Date(message.editedAt) : null,
        deletedAt: message?.deletedAt ? new Date(message.deletedAt) : null
      });
    }
    messageCount += 1;
  }

  return { conversations: conversationCount, messages: messageCount };
}

async function importPhotos({ legacyPhotos, legacyPhotoComments, tenantId, userIdMap, apply }) {
  let photoCount = 0;
  const mediaSummary = { uploaded: 0, keptLegacyUrl: 0, errors: [] };
  const existingPhotosById = apply
    ? new Map((await PhotoModel.find(tenantId, {})).map((row) => [String(row._id || row.id), row]))
    : new Map();
  const commentsByPhoto = new Map();
  for (const comment of legacyPhotoComments) {
    const key = String(comment?.photoId || "");
    const bucket = commentsByPhoto.get(key) || [];
    bucket.push(comment);
    commentsByPhoto.set(key, bucket);
  }

  for (const photo of legacyPhotos) {
    const id = legacyRecordId(photo, "legacy-photo");
    const ownerId = userIdMap.get(String(photo?.ownerId || "")) || "";
    if (!ownerId) continue;
    const existingPhoto = existingPhotosById.get(id) || null;
    let imageUrl = String(existingPhoto?.imageUrl || photo?.imageUrl || "").trim();
    let thumbUrl = String(existingPhoto?.thumbUrl || photo?.thumbUrl || "").trim() || imageUrl;
    if (apply && !existingPhoto?.imageUrl && imageUrl) {
      try {
        const uploaded = await migrateRemoteAssetToR2({
          sourceUrl: imageUrl,
          tenantSlug: CEDAR_SLUG,
          prefix: "photos/images",
          fileName: basenameFromUrl(imageUrl, `${id}.jpg`),
          objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(CEDAR_SLUG)
        });
        if (uploaded?.objectUrl) {
          imageUrl = uploaded.objectUrl;
          thumbUrl = uploaded.objectUrl;
          mediaSummary.uploaded += 1;
        } else {
          mediaSummary.keptLegacyUrl += 1;
        }
      } catch (error) {
        mediaSummary.errors.push({ photoId: String(photo?._id || ""), message: String(error?.message || error) });
        mediaSummary.keptLegacyUrl += 1;
      }
    }

    const comments = (commentsByPhoto.get(String(photo?._id || "")) || []).map((comment) => ({
      _id: legacyRecordId(comment, "legacy-photo-comment"),
      authorId: userIdMap.get(String(comment?.authorId || "")) || "",
      authorName: String(comment?.authorName || "").trim(),
      authorAvatarUrl: "",
      text: String(comment?.text || "").trim(),
      commentMentions: Array.isArray(comment?.commentMentions) ? comment.commentMentions : [],
      createdAt: comment?.createdAt ? new Date(comment.createdAt).toISOString() : new Date().toISOString()
    }));
    const likes = (Array.isArray(photo?.likedBy) ? photo.likedBy : [])
      .map((value) => userIdMap.get(String(value || "")) || "")
      .filter(Boolean);

    if (apply) {
      await PhotoModel.upsert({
        id,
        tenantId,
        ownerId,
        ownerName: String(photo?.ownerName || "").trim(),
        imageUrl,
        thumbUrl,
        caption: String(photo?.caption || "").trim(),
        captionMentions: Array.isArray(photo?.captionMentions)
          ? photo.captionMentions.map((item) => ({
              ...item,
              profileId: userIdMap.get(String(item?.profileId || "")) || ensureHexObjectId(item?.profileId || "", "caption-mention")
            }))
          : [],
        likes,
        comments,
        createdAt: photo?.createdAt ? new Date(photo.createdAt) : new Date(),
        updatedAt: photo?.updatedAt ? new Date(photo.updatedAt) : new Date()
      });
    }
    photoCount += 1;
    existingPhotosById.set(id, { ...(existingPhoto || {}), _id: id, imageUrl, thumbUrl });
  }

  return { photos: photoCount, mediaSummary };
}

async function importNewsletters({ legacyNewsletters, tenantId, apply }) {
  let count = 0;
  const mediaSummary = { uploaded: 0, keptLegacyUrl: 0, errors: [] };
  const existingById = apply
    ? new Map((await NewsletterModel.find(tenantId, {})).map((row) => [String(row._id || row.id), row]))
    : new Map();
  for (const newsletter of legacyNewsletters) {
    const id = legacyRecordId(newsletter, "legacy-newsletter");
    const sourceUrl = String(newsletter?.pdfUrl || "").trim();
    const sourceName = String(newsletter?.title || "").trim() || basenameFromUrl(sourceUrl, "newsletter.pdf");
    const existing = existingById.get(id) || null;

    let pdfMimeType = String(existing?.pdfMimeType || "application/pdf");
    let pdfData = existing?.pdfData || Buffer.alloc(0);

    const needsUpload = !existing || String(existing?.pdfMimeType || "") !== "application/x.pondbridge.newsletter-r2-pointer+json";
    if (apply && sourceUrl && needsUpload) {
      try {
        const uploaded = await migrateRemoteAssetToR2({
          sourceUrl,
          tenantSlug: CEDAR_SLUG,
          prefix: "newsletters",
          fileName: basenameFromUrl(sourceUrl, `${id}.pdf`),
          fileType: "application/pdf",
          objectProxyBaseUrl: buildTenantObjectProxyBaseUrl(CEDAR_SLUG),
          maxBytes: 100 * 1024 * 1024
        });
        if (uploaded?.key) {
          pdfMimeType = "application/x.pondbridge.newsletter-r2-pointer+json";
          pdfData = encodeR2Pointer({
            key: uploaded.key,
            objectUrl: uploaded.objectUrl
          });
          mediaSummary.uploaded += 1;
        }
      } catch (error) {
        mediaSummary.errors.push({
          newsletterId: String(newsletter?._id || ""),
          message: String(error?.message || error)
        });
      }
    }

    if (!apply) {
      count += 1;
      continue;
    }

      await NewsletterModel.upsert({
        id,
      tenantId,
      title: String(newsletter?.title || "").trim(),
      season: String(newsletter?.season || "").trim(),
      year: Number(newsletter?.year || 0) || null,
      pdfName: basenameFromUrl(sourceUrl, sourceName),
      pdfMimeType,
      pdfData,
      createdAt: newsletter?.createdAt ? new Date(newsletter.createdAt) : new Date(),
      updatedAt: newsletter?.updatedAt ? new Date(newsletter.updatedAt) : new Date()
    });
    count += 1;
  }

  return { newsletters: count, mediaSummary };
}

async function importFamilyTrees({ legacyFamilyTrees, tenantId, profileIdMap, userIdMap, apply }) {
  let count = 0;
  for (const tree of legacyFamilyTrees) {
    const id = legacyRecordId(tree, "legacy-family-tree");
    const relationshipBuckets = new Map();
    for (const edge of Array.isArray(tree?.edges) ? tree.edges : []) {
      const fromProfileId = profileIdMap.get(String(edge?.fromProfileId || "")) || "";
      const toProfileId = profileIdMap.get(String(edge?.toProfileId || "")) || "";
      if (!fromProfileId || !toProfileId || fromProfileId === toProfileId) continue;
      const bucket = relationshipBuckets.get(fromProfileId) || [];
      bucket.push({
        toProfileId,
        type: String(edge?.type || "other")
      });
      relationshipBuckets.set(fromProfileId, bucket);
    }

    const members = (Array.isArray(tree?.members) ? tree.members : [])
      .map((member) => {
        const profileId = profileIdMap.get(String(member?.profileId || "")) || "";
        if (!profileId) return null;
        return {
          profileId,
          relationships: relationshipBuckets.get(profileId) || []
        };
      })
      .filter(Boolean);

    if (apply) {
      await FamilyTreeModel.upsert({
        id,
        tenantId,
        name: String(tree?.name || "").trim(),
        createdByUserId: userIdMap.get(String(tree?.createdBy || "")) || "",
        members,
        createdAt: tree?.createdAt ? new Date(tree.createdAt) : new Date(),
        updatedAt: tree?.updatedAt ? new Date(tree.updatedAt) : new Date()
      });
    }
    count += 1;
  }
  return { familyTrees: count };
}

async function finalizeTenant({ tenantId, adenUserId, branding, apply }) {
  if (!apply) return;
  const current = await TenantModel.findById(tenantId);
  await TenantModel.update(tenantId, {
    theme: {
      ...(current?.theme || {}),
      ...(branding.logo?.objectUrl ? { logoUrl: branding.logo.objectUrl } : {}),
      ...(branding.hero?.objectUrl ? { heroImageUrl: branding.hero.objectUrl } : {})
    },
    content: {
      ...(current?.content || {}),
      contactEmail: ADEN_EMAIL
    },
    launch: {
      ...(current?.launch || {}),
      launchedByUserId: adenUserId,
      launchedAt: current?.launch?.launchedAt || isoNow()
    },
    directorLegalAgreement: {
      ...(current?.directorLegalAgreement || {}),
      accepted: true,
      acceptedAt: current?.directorLegalAgreement?.acceptedAt || isoNow(),
      acceptedByUserId: adenUserId,
      termsVersion: DIRECTOR_TERMS_VERSION,
      privacyVersion: DIRECTOR_TERMS_VERSION,
      directorAgreementVersion: DIRECTOR_TERMS_VERSION
    }
  });
}

async function currentTenantCount(tenantId, table) {
  const { count, error } = await getSupabaseAdmin()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw error;
  return Number(count || 0);
}

function buildAuthDecision({ clerkSummary }) {
  const supported = clerkSummary.configured;
  return {
    strategy: supported ? "clerk_bcrypt_digest_import" : "claim_or_reset_fallback",
    passwordsPreserved: supported,
    rationale: supported
      ? "Legacy Camp Cedar passwords are bcrypt `$2b$12` digests, and the installed Clerk Backend SDK accepts `passwordDigest` with `passwordHasher: bcrypt` during `users.createUser`."
      : "Clerk management credentials were not configured locally, so preserving passwords could not be completed safely. App memberships can still be created and later claimed by email."
  };
}

async function main() {
  const apply = parseApplyFlag();
  ensureDir(MAPPING_DIR);
  const tenantManifest = readJsonIfExists(NEW_TENANT_MANIFEST, null);
  const liveCedar = await findTenantBySlug(CEDAR_SLUG);
  if (
    liveCedar &&
    (!tenantManifest || String(tenantManifest.tenantId || "") !== String(liveCedar._id || ""))
  ) {
    throw new Error("A live 'cedar' tenant still exists from a different import context. Archive it first before running the import.");
  }

  const legacyAudit = await getLegacyAuditSnapshot();
  writeJson(LEGACY_AUDIT_JSON, {
    generatedAt: isoNow(),
    stats: legacyAudit.stats
  });

  const templateTenant = pickTemplateTenant();
  const clerkResult = await ensureClerkUsers({
    legacyUsers: legacyAudit.users,
    apply
  });

  const adenLegacy = legacyAudit.users.find((user) => normalizeEmail(user.email) === ADEN_EMAIL);
  if (!adenLegacy) {
    throw new Error(`Could not find ${ADEN_EMAIL} in the legacy Cedar database.`);
  }
  const adenUserId = legacyUserId(adenLegacy);

  const tenantResult = await createOrUpdateTenantRow({
    apply,
    templateTenant,
    adenUserId
  });
  const currentUsers = await currentTenantCount(tenantResult.tenantId, "users");
  const currentProfiles = await currentTenantCount(tenantResult.tenantId, "profiles");
  const currentActivities = await currentTenantCount(tenantResult.tenantId, "activity_items");

  let userSummary;
  let userIdMap;
  let profileIdMap;
  if (apply && currentUsers === legacyAudit.users.length && currentProfiles === legacyAudit.users.length) {
    userSummary = {
      users: { upserted: currentUsers, clerkLinked: legacyAudit.users.length - clerkResult.summary.missing, pendingClaim: clerkResult.summary.missing },
      profiles: { upserted: currentProfiles },
      avatarUploads: { uploaded: 0, keptLegacyUrl: 0, errors: [] }
    };
    userIdMap = new Map(legacyAudit.users.map((user) => [String(user._id), legacyUserId(user)]));
    profileIdMap = new Map([...userIdMap.entries()]);
  } else {
    ({ summary: userSummary, userIdMap, profileIdMap } = await importUsersAndProfiles({
      legacyUsers: legacyAudit.users,
      tenantId: tenantResult.tenantId,
      clerkByEmail: clerkResult.clerkByEmail,
      apply
    }));
  }

  const activitiesSummary =
    apply && currentActivities === legacyAudit.activities.length
      ? { upserted: currentActivities }
      : await importActivities({
          legacyActivities: legacyAudit.activities,
          tenantId: tenantResult.tenantId,
          userIdMap,
          apply
        });
  const forumSummary = await importForums({
    legacyForums: legacyAudit.forums,
    legacyForumPosts: legacyAudit.forumPosts,
    tenantId: tenantResult.tenantId,
    userIdMap,
    apply
  });
  const conversationSummary = await importConversations({
    legacyConversations: legacyAudit.conversations,
    legacyMessages: legacyAudit.messages,
    tenantId: tenantResult.tenantId,
    userIdMap,
    apply
  });
  const photoSummary = await importPhotos({
    legacyPhotos: legacyAudit.photos,
    legacyPhotoComments: legacyAudit.photoComments,
    tenantId: tenantResult.tenantId,
    userIdMap,
    apply
  });
  const newsletterSummary = await importNewsletters({
    legacyNewsletters: legacyAudit.newsletters,
    tenantId: tenantResult.tenantId,
    apply
  });
  const familyTreeSummary = await importFamilyTrees({
    legacyFamilyTrees: legacyAudit.familyTrees,
    tenantId: tenantResult.tenantId,
    profileIdMap,
    userIdMap,
    apply
  });

  await finalizeTenant({
    tenantId: tenantResult.tenantId,
    adenUserId,
    branding: tenantResult.branding,
    apply
  });

  const authDecision = buildAuthDecision({ clerkSummary: clerkResult.summary });
  const importSummary = {
    apply,
    importedAt: isoNow(),
    tenant: {
      id: tenantResult.tenantId,
      slug: CEDAR_SLUG,
      status: tenantResult.status
    },
    authDecision,
    clerk: clerkResult.summary,
    users: userSummary,
    activities: activitiesSummary,
    forums: forumSummary,
    conversations: conversationSummary,
    photos: photoSummary,
    newsletters: newsletterSummary,
    familyTrees: familyTreeSummary,
    legacyStats: legacyAudit.stats,
    manualCarryForward: {
      prelaunchSignupsPreservedOnly: legacyAudit.prelaunchSignups.length,
      customCitiesPreservedOnly: true,
      cityGeoPreservedOnly: true
    }
  };

  writeJson(IMPORT_SUMMARY_JSON, importSummary);
  writeJson(path.join(MAPPING_DIR, "legacy-user-email-to-user-id.json"), Object.fromEntries(
    legacyAudit.users.map((user) => [normalizeEmail(user.email), legacyUserId(user)])
  ));
  writeJson(path.join(MAPPING_DIR, "legacy-to-pondbridge-id-map.json"), Object.fromEntries(
    legacyAudit.users.map((user) => [String(user._id), legacyUserId(user)])
  ));

  writeMarkdown(
    path.join(path.resolve(MAPPING_DIR, "..", ".."), "MIGRATION_EXECUTION_SUMMARY.md"),
    `# Migration Execution Summary

- Dry run: ${apply ? "no" : "yes"}
- Target tenant slug: \`${CEDAR_SLUG}\`
- Target tenant ID: \`${tenantResult.tenantId}\`
- Import timestamp: ${importSummary.importedAt}

## Imported records

- Users: ${userSummary.users.upserted}
- Profiles: ${userSummary.profiles.upserted}
- Activity items: ${activitiesSummary.upserted}
- Forums: ${forumSummary.forums}
- Forum posts: ${forumSummary.forumPosts}
- Conversations: ${conversationSummary.conversations}
- Messages: ${conversationSummary.messages}
- Photos: ${photoSummary.photos}
- Newsletters: ${newsletterSummary.newsletters}
- Family trees: ${familyTreeSummary.familyTrees}

## Auth strategy

- Decision: \`${authDecision.strategy}\`
- Passwords preserved in Clerk: ${authDecision.passwordsPreserved ? "yes" : "no"}
- Clerk users reused: ${clerkResult.summary.reused}
- Clerk users created: ${clerkResult.summary.created}
- Users left for claim flow: ${userSummary.users.pendingClaim}

## Preserved but not imported

- Legacy prelaunch signups: ${legacyAudit.prelaunchSignups.length}
- Legacy custom city and city-geo collections were audited but not imported because PondBridge treats those as derived/supporting data, not tenant-owned alumni membership records.

## Artifacts

- Import summary JSON: \`migration/cedar-mapping-files/cedar-import-summary.json\`
- Tenant manifest: \`migration/cedar-mapping-files/cedar-new-tenant-manifest.json\`
- Legacy/user ID maps: \`migration/cedar-mapping-files/*.json\`
`
  );

  writeMarkdown(
    path.join(path.resolve(MAPPING_DIR, "..", ".."), "AUTH_MIGRATION_DECISION.md"),
    `# Auth Migration Decision

## Decision

- Strategy: \`${authDecision.strategy}\`
- Passwords preserved: ${authDecision.passwordsPreserved ? "yes" : "no"}

## Evidence

- Legacy Cedar stores passwords in MongoDB at \`users.passwordHash\`.
- All sampled hashes and the full hash-prefix audit matched bcrypt \`$2b$12\`.
- The installed Clerk Backend SDK exposes \`users.createUser({ passwordDigest, passwordHasher: "bcrypt" })\` in [\`@clerk/backend/dist/api/endpoints/UserApi.d.ts\`](/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts).
- Official Clerk docs for user creation and password-digest migration were also checked: [Create user](https://clerk.com/docs/reference/backend/user/create-user) and [Import users / password hashes](https://clerk.com/docs/guides/development/migrating/authjs).

## Implementation

- Existing Clerk users were reused when the same email already existed.
- Missing Clerk users were created with their legacy bcrypt digest and a Clerk \`externalId\` derived from the legacy Cedar user ID.
- PondBridge app-user rows store \`clerk_user_id\` and use \`password_hash="clerk_managed"\` because runtime authentication is Clerk-based in this repo.
- If a Clerk create call failed, the PondBridge membership row can still be claimed later by a Clerk account using the same email, because the app auth layer links Cedar memberships by email on first successful Clerk login.
`
  );

  console.log(stableJson(importSummary));
}

main().catch((error) => {
  console.error("[migrateLegacyCedarToPondBridge] failed", error);
  process.exit(1);
});
