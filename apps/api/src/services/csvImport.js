import crypto from "crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { z } from "zod";
import { UserModel, ProfileModel, ImportReportModel } from "../db/models/index.js";
import { hashPassword } from "../utils/auth.js";
import { composeCityState, parseCityStateDetailed } from "../utils/location.js";

const acceptedColumns = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "cityState",
  "roleAtCamp",
  "gradYear"
];

const csvRowSchema = z.object({
  firstName: z.string().trim().min(1, "firstName is required"),
  lastName: z.string().trim().min(1, "lastName is required"),
  email: z.string().trim().email("email must be valid"),
  phone: z.string().trim().optional().default(""),
  cityState: z.string().trim().optional().default(""),
  roleAtCamp: z.string().trim().optional().default(""),
  gradYear: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((value) => {
      if (!value) return "";
      return value;
    })
});

function normalizeHeader(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .toLowerCase();
}

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

function canonicalizeCityState(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return composeCityState(parseCityStateDetailed(raw));
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

function canonicalizeRow(rawRow = {}) {
  const mapped = {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    cityState: "",
    roleAtCamp: "",
    gradYear: ""
  };

  const entries = Object.entries(rawRow || {});
  for (const [key, value] of entries) {
    const normalized = normalizeHeader(key);
    const stringValue = String(value ?? "").trim();

    if (["firstname"].includes(normalized)) mapped.firstName = stringValue;
    if (["lastname"].includes(normalized)) mapped.lastName = stringValue;
    if (["email", "emailaddress"].includes(normalized)) mapped.email = stringValue;
    if (["phone", "phonenumber"].includes(normalized)) mapped.phone = stringValue;
    if (["citystate", "location", "city"].includes(normalized)) mapped.cityState = stringValue;
    if (["roleatcamp", "camprole", "role"].includes(normalized)) mapped.roleAtCamp = stringValue;
    if (["gradyear", "graduationyear"].includes(normalized)) mapped.gradYear = stringValue;
  }

  return {
    ...mapped,
    email: normalizeEmail(mapped.email),
    cityState: canonicalizeCityState(mapped.cityState)
  };
}

function rowToFailureCsvRecord(error) {
  const raw = error.rawRow || {};
  return {
    rowNumber: error.rowNumber,
    code: error.code,
    message: error.message,
    firstName: raw.firstName || "",
    lastName: raw.lastName || "",
    email: raw.email || "",
    cityState: raw.cityState || "",
    roleAtCamp: raw.roleAtCamp || "",
    gradYear: raw.gradYear || ""
  };
}

function ensureStringArray(values = []) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function rowToProfilePatch(validRow, existingProfile) {
  const patch = {};

  if (validRow.firstName && validRow.firstName !== existingProfile.firstName) {
    patch.firstName = validRow.firstName;
  }

  if (validRow.lastName && validRow.lastName !== existingProfile.lastName) {
    patch.lastName = validRow.lastName;
  }

  if (validRow.phone) {
    const existingPhones = ensureStringArray(existingProfile.phones);
    if (!existingPhones.includes(validRow.phone)) {
      patch.phones = [...existingPhones, validRow.phone];
    }
  }

  if (validRow.cityState && validRow.cityState !== existingProfile.cityState) {
    patch.cityState = validRow.cityState;
  }

  if (validRow.roleAtCamp && validRow.roleAtCamp !== existingProfile.roleAtCamp) {
    patch.roleAtCamp = validRow.roleAtCamp;
  }

  if (validRow.gradYear) {
    const existingYears = ensureStringArray(existingProfile.collegeYears);
    if (!existingYears.includes(validRow.gradYear)) {
      patch.collegeYears = [...existingYears, validRow.gradYear];
    }
  }

  const existingEmails = ensureStringArray(existingProfile.emails);
  if (validRow.email && !existingEmails.includes(validRow.email)) {
    patch.emails = [...existingEmails, validRow.email];
  }

  return patch;
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

async function createProfileForRow({ tenantId, row, mapState }) {
  const generatedPassword = crypto.randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(generatedPassword);

  const user = await UserModel.create({
    tenantId,
    email: row.email,
    passwordHash,
    roles: ["user"],
    status: "active"
  });

  const profile = await ProfileModel.create({
    tenantId,
    userId: user._id,
    firstName: row.firstName,
    lastName: row.lastName,
    emails: [row.email],
    phones: row.phone ? [row.phone] : [],
    cityState: row.cityState || "",
    roleAtCamp: row.roleAtCamp || "",
    highSchool: "",
    colleges: [],
    collegeYears: row.gradYear ? [row.gradYear] : [],
    currentJobs: [],
    pastJobs: [],
    industry: "",
    socials: { linkedin: "", instagram: "", facebook: "" },
    avatarUrl: "",
    bio: ""
  });

  await UserModel.update(user._id, { profileId: profile._id });

  const createdPair = { user, profile };

  mapState.emailMap.set(row.email, createdPair);
  const secondaryKey = buildSecondaryKey(row.firstName, row.lastName, row.cityState);
  if (secondaryKey) {
    mapState.secondaryMap.set(secondaryKey, createdPair);
  }

  mapState.profilePool.push({
    profileId: String(profile._id),
    userId: String(user._id),
    email: row.email,
    fullName: fullName(row.firstName, row.lastName),
    cityState: normalizeCityState(row.cityState),
    profile,
    user
  });
}

export async function runTenantCsvImport({
  tenantId,
  userId,
  fileName,
  csvBuffer,
  options = {}
}) {
  const enableFuzzyMatch = Boolean(options.enableFuzzyMatch);
  const fuzzyDistance = Math.min(4, Math.max(0, Number(options.fuzzyDistance ?? 1) || 1));

  const csvText = Buffer.isBuffer(csvBuffer) ? csvBuffer.toString("utf8") : String(csvBuffer || "");

  let parsedRows = [];
  try {
    parsedRows = parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true
    });
  } catch (error) {
    const csvError = new Error(error.message || "Invalid CSV format");
    csvError.code = "CSV_INVALID_FORMAT";
    throw csvError;
  }

  const existingProfiles = await ProfileModel.find(tenantId);
  const existingUsers = await UserModel.find(tenantId);
  const mapState = buildExistingMaps(existingProfiles, existingUsers);

  const errors = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedDuplicates = 0;

  for (let index = 0; index < parsedRows.length; index += 1) {
    const rowNumber = index + 2;
    const canonical = canonicalizeRow(parsedRows[index]);

    const parsed = csvRowSchema.safeParse(canonical);
    if (!parsed.success) {
      errors.push({
        rowNumber,
        code: "VALIDATION_ERROR",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
        rawRow: canonical
      });
      continue;
    }

    const row = parsed.data;

    const primaryDuplicate = mapState.emailMap.get(row.email);
    if (primaryDuplicate) {
      try {
        const patch = rowToProfilePatch(row, primaryDuplicate.profile);
        const patchKeys = Object.keys(patch);

        if (patchKeys.length === 0) {
          skippedDuplicates += 1;
          continue;
        }

        const updatedProfile = await ProfileModel.update(primaryDuplicate.profile._id, patch);

        primaryDuplicate.profile = updatedProfile;

        const secondaryKey = buildSecondaryKey(
          updatedProfile.firstName,
          updatedProfile.lastName,
          updatedProfile.cityState
        );
        if (secondaryKey) {
          mapState.secondaryMap.set(secondaryKey, {
            user: primaryDuplicate.user,
            profile: updatedProfile
          });
        }

        const poolItem = mapState.profilePool.find(
          (candidate) => String(candidate.profileId) === String(updatedProfile._id)
        );
        if (poolItem) {
          poolItem.profile = updatedProfile;
          poolItem.fullName = fullName(updatedProfile.firstName, updatedProfile.lastName);
          poolItem.cityState = normalizeCityState(updatedProfile.cityState);
        }

        updatedCount += 1;
      } catch (error) {
        errors.push({
          rowNumber,
          code: "UPDATE_ERROR",
          message: error.message || "Failed to update duplicate row",
          rawRow: row
        });
      }
      continue;
    }

    const secondaryKey = buildSecondaryKey(row.firstName, row.lastName, row.cityState);
    if (secondaryKey && mapState.secondaryMap.has(secondaryKey)) {
      skippedDuplicates += 1;
      continue;
    }

    if (enableFuzzyMatch) {
      const fuzzyDuplicate = findFuzzyDuplicate({
        candidateFullName: fullName(row.firstName, row.lastName),
        candidateCityState: row.cityState,
        profilePool: mapState.profilePool,
        fuzzyDistance
      });

      if (fuzzyDuplicate) {
        skippedDuplicates += 1;
        continue;
      }
    }

    try {
      await createProfileForRow({ tenantId, row, mapState });
      createdCount += 1;
    } catch (error) {
      errors.push({
        rowNumber,
        code: "CREATE_ERROR",
        message: error.message || "Failed to create profile",
        rawRow: row
      });
    }
  }

  const failureCsv = errors.length
    ? stringify(errors.map((error) => rowToFailureCsvRecord(error)), { header: true })
    : "";

  const report = await ImportReportModel.create({
    tenantId,
    createdByUserId: userId,
    fileName: fileName || "import.csv",
    options: {
      enableFuzzyMatch,
      fuzzyDistance
    },
    summary: {
      rowsRead: parsedRows.length,
      createdCount,
      updatedCount,
      skippedDuplicates,
      errorCount: errors.length
    },
    rowErrors: errors,
    failureCsv
  });

  return {
    reportId: String(report._id),
    acceptedColumns,
    rowsRead: parsedRows.length,
    createdCount,
    updatedCount,
    skippedDuplicates,
    errors,
    failureCsv
  };
}

export async function findImportReportForTenant({ tenantId, reportId }) {
  return ImportReportModel.findOne(tenantId, { _id: reportId });
}
