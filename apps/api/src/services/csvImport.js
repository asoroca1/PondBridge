import crypto from "crypto";
import { stringify } from "csv-stringify/sync";
import { UserModel, ProfileModel, ImportReportModel } from "../db/models/index.js";
import { collectAll } from "../db/queryLimits.js";
import { hashPassword } from "../utils/auth.js";
import { buildImportBody, isKnownImportField } from "./importFieldMap.js";
import { parseImportCsv } from "./importCsvParse.js";
import { isUnclaimedProfile } from "./memberVisibility.js";
import { profilePayloadFromBody } from "./profilePayload.js";

/**
 * Turns a camp's questionnaire export into profiles that are waiting to be
 * claimed.
 *
 * Two things make this different from the seven-column importer it replaces.
 * It writes every field a member can fill in themselves, through the same
 * normalizers their own signup uses, so an imported member is indistinguishable
 * from one who typed it all in. And the profiles it creates are "pending", which
 * keeps them out of the directory, the member count and the map until the person
 * they describe signs in and confirms them.
 *
 * The columns are not fixed. A caller supplies a mapping of spreadsheet column to
 * profile field; producing that mapping automatically is a separate concern.
 */

function normalizeName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCityState(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function fullName(firstName = "", lastName = "") {
  return normalizeName(`${String(firstName || "").trim()} ${String(lastName || "").trim()}`);
}

function buildSecondaryKey(firstName = "", lastName = "", cityState = "") {
  const name = fullName(firstName, lastName);
  const city = normalizeCityState(cityState);
  if (!name || !city) return "";
  return `${name}|${city}`;
}

function levenshteinDistance(a = "", b = "") {
  const left = String(a);
  const right = String(b);

  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => []);

  for (let row = 0; row <= left.length; row += 1) matrix[row][0] = row;
  for (let column = 0; column <= right.length; column += 1) matrix[0][column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}
function ensureStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}
function buildExistingMaps(existingProfiles = [], existingUsers = []) {
  const usersById = new Map(existingUsers.map((user) => [String(user._id), user]));
  const usersByEmail = new Map();
  for (const user of existingUsers) {
    usersByEmail.set(normalizeEmail(user.email), user);
  }

  const profilesByUserId = new Map(existingProfiles.map((profile) => [String(profile.userId), profile]));
  const emailMap = new Map();
  const secondaryMap = new Map();
  const profilePool = [];

  for (const profile of existingProfiles) {
    const user = usersById.get(String(profile.userId));
    if (!user) continue;

    const profileName = fullName(profile.firstName, profile.lastName);
    const profileCity = normalizeCityState(profile.cityState);

    profilePool.push({
      profileId: String(profile._id),
      userId: String(user._id),
      email: normalizeEmail(user.email),
      fullName: profileName,
      cityState: profileCity,
      profile,
      user
    });

    const userEmail = normalizeEmail(user.email);
    if (userEmail) {
      emailMap.set(userEmail, { user, profile });
    }

    const secondaryKey = buildSecondaryKey(profile.firstName, profile.lastName, profile.cityState);
    if (secondaryKey) {
      secondaryMap.set(secondaryKey, { user, profile });
    }
  }

  return { usersByEmail, profilesByUserId, emailMap, secondaryMap, profilePool };
}

function findFuzzyDuplicate({
  candidateFullName,
  candidateCityState,
  profilePool,
  fuzzyDistance
}) {
  if (!candidateFullName) return null;

  const city = normalizeCityState(candidateCityState);
  const scopedPool = city
    ? profilePool.filter((candidate) => candidate.cityState === city)
    : profilePool;

  for (const candidate of scopedPool) {
    const distance = levenshteinDistance(candidate.fullName, candidateFullName);
    if (distance <= fuzzyDistance) {
      return { ...candidate, distance };
    }
  }

  return null;
}
/**
 * A blank cell means "leave this alone", so an update only ever adds. Arrays gain
 * entries they do not already have, and a scalar is set only where the profile
 * has nothing — a director's spreadsheet does not get to overwrite what a member
 * wrote about themselves.
 */
function profilePatchFromPayload(payload, existingProfile) {
  const patch = {};

  for (const key of ["firstName", "lastName", "cityState", "roleAtCamp", "highSchool", "industry", "bio", "avatarUrl"]) {
    const next = String(payload[key] || "").trim();
    if (!next) continue;
    if (String(existingProfile[key] || "").trim()) continue;
    patch[key] = next;
  }

  for (const key of ["emails", "phones", "colleges", "collegeYears"]) {
    const incoming = ensureStringArray(payload[key]);
    if (!incoming.length) continue;
    const existing = ensureStringArray(existingProfile[key]);
    const merged = [...existing];
    for (const value of incoming) {
      if (!merged.some((item) => item.toLowerCase() === value.toLowerCase())) merged.push(value);
    }
    if (merged.length !== existing.length) patch[key] = merged;
  }

  for (const key of ["currentJobs", "pastJobs"]) {
    const incoming = Array.isArray(payload[key]) ? payload[key] : [];
    if (!incoming.length) continue;
    const existing = Array.isArray(existingProfile[key]) ? existingProfile[key] : [];
    const signature = (job) => `${String(job?.role || "").trim().toLowerCase()}|${String(job?.company || "").trim().toLowerCase()}`;
    const seen = new Set(existing.map(signature));
    const merged = [...existing];
    for (const job of incoming) {
      if (seen.has(signature(job))) continue;
      seen.add(signature(job));
      merged.push(job);
    }
    if (merged.length !== existing.length) patch[key] = merged;
  }

  // The socials blob carries camp years, roles and majors as well as the social
  // links, so it merges key by key rather than being replaced wholesale.
  const incomingSocials = payload.socials && typeof payload.socials === "object" ? payload.socials : {};
  const existingSocials = existingProfile.socials && typeof existingProfile.socials === "object"
    ? existingProfile.socials
    : {};
  const socialsPatch = { ...existingSocials };
  let socialsChanged = false;
  for (const [key, value] of Object.entries(incomingSocials)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    if (key === "camperYears") {
      const existingYears = existingSocials.camperYears && typeof existingSocials.camperYears === "object"
        ? existingSocials.camperYears
        : {};
      const nextYears = { ...existingYears };
      for (const [yearKey, yearValue] of Object.entries(value || {})) {
        if (!String(yearValue || "").trim()) continue;
        if (String(existingYears[yearKey] || "").trim()) continue;
        nextYears[yearKey] = yearValue;
        socialsChanged = true;
      }
      socialsPatch.camperYears = nextYears;
      continue;
    }
    if (existingSocials[key] !== undefined && String(existingSocials[key] || "").trim()) continue;
    socialsPatch[key] = value;
    socialsChanged = true;
  }
  if (socialsChanged) patch.socials = socialsPatch;

  return patch;
}

function rowToFailureCsvRecord(error) {
  const raw = error.rawRow && typeof error.rawRow === "object" ? error.rawRow : {};
  return {
    rowNumber: error.rowNumber,
    code: error.code,
    message: error.message,
    ...raw
  };
}

/**
 * Records which import put a profile there. There is no column for it, and the
 * socials blob is already where the profile keeps everything that is not a
 * column, so it lives there — enough to find every row one bad import created.
 */
function stampProvenance(socials = {}, reportId = "") {
  return {
    ...(socials && typeof socials === "object" ? socials : {}),
    importedFrom: { reportId: String(reportId || ""), importedAt: new Date().toISOString() }
  };
}

/**
 * Records a row as taken, so later rows in the same file see it.
 *
 * Called on a dry run too, where nothing is written. A questionnaire that holds
 * the same person twice is ordinary — people resubmit — and without this the
 * preview counted the second copy as another new profile, promising a director
 * one more account than the commit would actually create.
 */
function rememberRow({ mapState, email, payload, profile = null, user = null }) {
  const pair = { user, profile };
  mapState.emailMap.set(email, pair);

  const secondaryKey = buildSecondaryKey(payload.firstName, payload.lastName, payload.cityState);
  if (secondaryKey) mapState.secondaryMap.set(secondaryKey, pair);

  mapState.profilePool.push({
    profileId: String(profile?._id || ""),
    userId: String(user?._id || ""),
    email,
    fullName: fullName(payload.firstName, payload.lastName),
    cityState: normalizeCityState(payload.cityState),
    profile,
    user
  });
}

async function createProfileForRow({ tenantId, payload, email, reportId, mapState, passwordHash }) {

  const user = await UserModel.create({
    tenantId,
    email,
    passwordHash,
    roles: ["user"],
    status: "active"
  });

  const profile = await ProfileModel.create({
    tenantId,
    userId: user._id,
    ...payload,
    emails: payload.emails?.length ? payload.emails : [email],
    socials: stampProvenance(payload.socials, reportId),
    // The one line that keeps an imported person out of the directory until they
    // sign in and say the profile is theirs.
    status: "pending"
  });

  await UserModel.update(user._id, { profileId: profile._id });

  rememberRow({ mapState, email, payload, profile, user });
  return profile;
}

/**
 * A ceiling on one file. The commit walks rows inside a single request, so a
 * questionnaire past this belongs in a couple of files rather than one that
 * times out halfway and leaves a director guessing what landed.
 */
export const MAX_IMPORT_ROWS = 2000;

export function validateImportMapping(mapping = {}) {
  const entries = Object.entries(mapping || {});
  const unknown = [];
  const paths = new Set();

  for (const [column, target] of entries) {
    for (const path of Array.isArray(target) ? target : [target]) {
      const trimmed = String(path || "").trim();
      if (!trimmed) continue;
      if (!isKnownImportField(trimmed)) unknown.push({ column, path: trimmed });
      paths.add(trimmed);
    }
  }

  return { unknown, hasEmail: paths.has("email") };
}

/**
 * Runs an import, or works out what one would do.
 *
 * With `dryRun` nothing is written and every row comes back with the disposition
 * it would have had. That is the whole safety property of the feature: a director
 * sees creates, updates, duplicates and failures before any of it exists.
 */
export async function runTenantCsvImport({
  tenantId,
  userId,
  fileName,
  csvBuffer,
  mapping = {},
  cleanedValues = null,
  options = {}
}) {
  const dryRun = Boolean(options.dryRun);
  const enableFuzzyMatch = Boolean(options.enableFuzzyMatch);
  const fuzzyDistance = Math.min(4, Math.max(0, Number(options.fuzzyDistance ?? 1) || 1));

  const { unknown, hasEmail } = validateImportMapping(mapping);
  if (unknown.length) {
    const error = new Error(`Unknown import field: ${unknown.map((item) => item.path).join(", ")}`);
    error.code = "IMPORT_FIELD_UNKNOWN";
    throw error;
  }
  if (!hasEmail) {
    // Email is how a person later claims the row. Without it an import creates
    // profiles nobody can ever sign in to.
    const error = new Error("Map a column to the email address before importing.");
    error.code = "IMPORT_EMAIL_REQUIRED";
    throw error;
  }

  const parsedRows = parseImportCsv(csvBuffer);
  if (parsedRows.length > MAX_IMPORT_ROWS) {
    const error = new Error(
      `That file has ${parsedRows.length} responses, and ${MAX_IMPORT_ROWS} is the most one import can take. Split it and run them in turn.`
    );
    error.code = "IMPORT_TOO_MANY_ROWS";
    throw error;
  }

  // These build the dedupe maps for the whole import, so they have to be complete.
  // A capped read makes every member past the first 1,000 look new, which would
  // create duplicates instead of updating people who are already there —
  // findAllBatched keyset-walks the whole tenant rather than truncating.
  const existingProfiles = await collectAll(ProfileModel.findAllBatched(tenantId));
  const existingUsers = await collectAll(UserModel.findAllBatched(tenantId));
  const mapState = buildExistingMaps(existingProfiles, existingUsers);

  const errors = [];
  const dispositions = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedDuplicates = 0;

  // Written before the rows so a run that times out still leaves a record of what
  // was attempted, rather than a half-import with nothing to point at.
  const report = dryRun
    ? null
    : await ImportReportModel.create({
      tenantId,
      createdByUserId: userId,
      fileName: fileName || "import.csv",
      options: { enableFuzzyMatch, fuzzyDistance, mapping },
      summary: { rowsRead: parsedRows.length, createdCount: 0, updatedCount: 0, skippedDuplicates: 0, errorCount: 0 },
      rowErrors: [],
      failureCsv: ""
    });
  const reportId = report ? String(report._id) : "";
  // Imported accounts have no usable password. Hash one fresh 256-bit secret
  // per run, only when a new account is needed, and discard the plaintext.
  // Repeating bcrypt for every row adds minutes to a normal camp import while
  // giving no extra protection to credentials nobody knows or receives.
  let importPasswordHash = "";

  for (let index = 0; index < parsedRows.length; index += 1) {
    const rowNumber = index + 2;
    const rawRow = parsedRows[index];
    const { body, skipped } = buildImportBody(rawRow, mapping, cleanedValues);

    const email = normalizeEmail(body.email || "");
    if (!email) {
      errors.push({
        rowNumber,
        code: "EMAIL_REQUIRED",
        message: "This row has no usable email address, so nobody could ever claim it.",
        rawRow
      });
      continue;
    }

    // profilePayloadFromBody takes the address from the identity, which an import
    // does not have — the row is the identity here.
    const payload = profilePayloadFromBody(body, { email });
    if (!payload.firstName && !payload.lastName) {
      errors.push({
        rowNumber,
        code: "NAME_REQUIRED",
        message: "This row has no name, so nobody could recognise the profile as theirs.",
        rawRow
      });
      continue;
    }

    const primaryDuplicate = mapState.emailMap.get(email);
    if (primaryDuplicate) {
      // No profile behind it means this file already held this person and the run
      // is a dry one, so there is nothing on record to compare against yet. The
      // row is a repeat either way.
      if (!primaryDuplicate.profile) {
        skippedDuplicates += 1;
        dispositions.push({ rowNumber, email, disposition: "duplicate", reason: "repeated_in_file" });
        continue;
      }
      const patch = profilePatchFromPayload(payload, primaryDuplicate.profile);
      if (!Object.keys(patch).length) {
        skippedDuplicates += 1;
        dispositions.push({ rowNumber, email, disposition: "unchanged" });
        continue;
      }
      dispositions.push({ rowNumber, email, disposition: "update", fields: Object.keys(patch) });
      if (!dryRun) {
        try {
          const updatedProfile = await ProfileModel.update(primaryDuplicate.profile._id, patch);
          primaryDuplicate.profile = updatedProfile;
          const poolItem = mapState.profilePool.find(
            (candidate) => String(candidate.profileId) === String(updatedProfile._id)
          );
          if (poolItem) {
            poolItem.profile = updatedProfile;
            poolItem.fullName = fullName(updatedProfile.firstName, updatedProfile.lastName);
            poolItem.cityState = normalizeCityState(updatedProfile.cityState);
          }
        } catch (error) {
          errors.push({ rowNumber, code: "UPDATE_ERROR", message: error.message || "Failed to update", rawRow });
          continue;
        }
      }
      updatedCount += 1;
      continue;
    }

    const secondaryKey = buildSecondaryKey(payload.firstName, payload.lastName, payload.cityState);
    if (secondaryKey && mapState.secondaryMap.has(secondaryKey)) {
      skippedDuplicates += 1;
      dispositions.push({ rowNumber, email, disposition: "duplicate", reason: "name_and_city" });
      continue;
    }

    if (enableFuzzyMatch) {
      const fuzzyDuplicate = findFuzzyDuplicate({
        candidateFullName: fullName(payload.firstName, payload.lastName),
        candidateCityState: payload.cityState,
        profilePool: mapState.profilePool,
        fuzzyDistance
      });
      if (fuzzyDuplicate) {
        skippedDuplicates += 1;
        dispositions.push({ rowNumber, email, disposition: "duplicate", reason: "fuzzy_name" });
        continue;
      }
    }

    dispositions.push({
      rowNumber,
      email,
      disposition: "create",
      unparseable: skipped.length ? skipped : undefined
    });
    if (dryRun) {
      rememberRow({ mapState, email, payload });
    } else {
      try {
        if (!importPasswordHash) {
          importPasswordHash = await hashPassword(crypto.randomBytes(32).toString("base64url"));
        }
        await createProfileForRow({ tenantId, payload, email, reportId, mapState, passwordHash: importPasswordHash });
      } catch (error) {
        errors.push({ rowNumber, code: "CREATE_ERROR", message: error.message || "Failed to create", rawRow });
        continue;
      }
    }
    createdCount += 1;
  }

  const failureCsv = errors.length
    ? stringify(errors.map((error) => rowToFailureCsvRecord(error)), { header: true })
    : "";
  const summary = {
    rowsRead: parsedRows.length,
    createdCount,
    updatedCount,
    skippedDuplicates,
    errorCount: errors.length
  };

  if (report) {
    await ImportReportModel.update(report._id, { summary, rowErrors: errors, failureCsv });
  }

  return {
    reportId,
    dryRun,
    ...summary,
    dispositions,
    errors,
    failureCsv
  };
}

export async function findImportReportForTenant({ tenantId, reportId }) {
  return ImportReportModel.findOne(tenantId, { _id: reportId });
}

export function wasCreatedByImport(profile, reportId = "") {
  const stamp = profile?.socials?.importedFrom;
  return Boolean(reportId) && String(stamp?.reportId || "") === String(reportId);
}

/**
 * Takes back an import.
 *
 * The reason a bad import is survivable: every profile it created carries the id
 * of the run that created it, so the whole batch can be found and removed.
 *
 * It only ever removes rows that are still unclaimed. Once someone has signed in
 * and confirmed a profile, the account is theirs — deleting it because a director
 * regrets the upload would take away something a person now relies on. Those are
 * counted and reported instead, so the director knows exactly what stayed and
 * why.
 */
export async function undoTenantImport({ tenantId, reportId }) {
  const report = await ImportReportModel.findOne(tenantId, { _id: reportId });
  if (!report) {
    const error = new Error("That import could not be found.");
    error.code = "IMPORT_REPORT_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  // The stamp lives inside the socials blob, which PostgREST cannot filter on
  // through this model, so the tenant's profiles are read and matched here.
  const profiles = await collectAll(ProfileModel.findAllBatched(tenantId));
  const fromThisImport = profiles.filter((profile) => wasCreatedByImport(profile, reportId));

  let removedCount = 0;
  let keptClaimedCount = 0;
  const failures = [];

  for (const profile of fromThisImport) {
    if (!isUnclaimedProfile(profile)) {
      keptClaimedCount += 1;
      continue;
    }
    try {
      await ProfileModel.delete(profile._id);
      if (profile.userId) await UserModel.delete(profile.userId);
      removedCount += 1;
    } catch (error) {
      failures.push({ profileId: String(profile._id), message: error.message || "Could not remove" });
    }
  }

  await ImportReportModel.update(report._id, {
    summary: {
      ...(report.summary && typeof report.summary === "object" ? report.summary : {}),
      undoneAt: new Date().toISOString(),
      removedCount,
      keptClaimedCount
    }
  }).catch(() => {});

  return {
    reportId: String(report._id),
    matchedCount: fromThisImport.length,
    removedCount,
    keptClaimedCount,
    failures
  };
}

export async function listImportReportsForTenant({ tenantId, limit = 20 }) {
  return ImportReportModel.find(tenantId, {}, { sort: { createdAt: -1 }, limit });
}

// The merge rule decides whether a re-import can overwrite what a member wrote
// about themselves, so it is tested directly rather than only through a run that
// needs a database.
export const __testables = { profilePatchFromPayload, stampProvenance, rememberRow, buildExistingMaps };
