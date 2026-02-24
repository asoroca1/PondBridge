import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { requestJson } from "../lib/http.js";
import { defaultTenantDomain } from "../lib/domain.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { readWizardDraft, writeWizardDraft, clearWizardDraft } from "../lib/storage.js";
import DirectorCreateAccountClerkPage from "./DirectorCreateAccountClerkPage.jsx";

const STEP_ACCOUNT = "account";
const STEP_DESIGN = "design";
const STEP_FEATURES = "features";
const STEP_CAMP_SPECIFICS = "camp_specifics";
const STEP_BILLING_PLAN = "billing_plan";
const STEP_REVIEW_LAUNCH = "review_launch";
const DEFAULT_SETUP_BRAND = "#0f2747";

const STEP_ORDER = [
  STEP_ACCOUNT,
  STEP_DESIGN,
  STEP_FEATURES,
  STEP_CAMP_SPECIFICS,
  STEP_BILLING_PLAN,
  STEP_REVIEW_LAUNCH
];
const DEFAULT_FEATURE_MODULES = {
  directory: true,
  search: true,
  photoStream: true,
  chat: true,
  map: true,
  familyTrees: true,
  relatedProfiles: true,
  newsletter: true,
  merchShop: true
};
const DEFAULT_AGE_GROUPS = [
  "Super Warrior",
  "Warrior",
  "Freshman",
  "Sophomore",
  "Junior",
  "Intermediate",
  "Senior I",
  "Senior II"
];
const DEFAULT_STAFF_ROLES = ["Camper", "Counselor", "JC", "CIT", "Admin"];
const DEFAULT_TERMS_VERSION = "2026-02-21";
const DEFAULT_PRIVACY_VERSION = "2026-02-21";
const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States"
};
const BILLING_PLAN_OPTIONS = [
  {
    code: "legacy",
    title: "Legacy Plan",
    annualAmount: 3500,
    onboardingFeeAmount: 350,
    summary: "Core alumni network features with annual billing."
  },
  {
    code: "founders",
    title: "Founders Plan",
    annualAmount: 2800,
    onboardingFeeAmount: 0,
    summary: "Discounted annual pricing for the first 10 camps."
  },
  {
    code: "institutional",
    title: "Institutional Plan",
    annualAmount: 5500,
    onboardingFeeAmount: 750,
    summary: "Advanced feature tier with institutional-level support."
  }
];

function normalizeBillingPlanCode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return BILLING_PLAN_OPTIONS.some((item) => item.code === normalized) ? normalized : "legacy";
}

function billingPlanLabel(code = "") {
  const match = BILLING_PLAN_OPTIONS.find((item) => item.code === normalizeBillingPlanCode(code));
  return match ? match.title : "Legacy Plan";
}

const FEATURE_OPTIONS = [
  {
    key: "search",
    title: "Advanced Search",
    description: "Search alumni by name, camp role, location, industry, and more."
  },
  {
    key: "photoStream",
    title: "Photo Stream",
    description: "Shared photo gallery where alumni upload and browse camp photos."
  },
  {
    key: "chat",
    title: "Chats and Forums",
    description: "Direct messages and community discussion spaces."
  },
  {
    key: "map",
    title: "Alumni Location Map",
    description: "Interactive map showing where your alumni live and work."
  },
  {
    key: "familyTrees",
    title: "Family Trees",
    description: "Visualize multi-generational camp family connections."
  },
  {
    key: "relatedProfiles",
    title: "Related Profiles",
    description: "Show connections between alumni across profile pages sitewide."
  },
  {
    key: "merchShop",
    title: "Merch Shop",
    description: "Link to your camp's merchandise store."
  },
  {
    key: "newsletter",
    title: "Newsletter",
    description: "Newsletter archive and announcements section for your camp."
  }
];

function emailLooksValid(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function isHexColor(value = "") {
  return /^#([0-9a-fA-F]{6})$/.test(String(value).trim());
}

function darkenHex(hex, factor = 0.18) {
  if (!isHexColor(hex)) return "#0b1e37";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16));
  const darkened = channels.map((value) => Math.max(0, Math.min(255, Math.round(value * (1 - factor)))));
  return `#${darkened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function deriveSecondaryHex(hex, blend = 0.82) {
  if (!isHexColor(hex)) return "#d3dde8";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16));
  const lightened = channels.map((value) =>
    Math.min(255, Math.round(value + (255 - value) * blend))
  );
  return `#${lightened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function parseLineList(value = "") {
  return [...new Set(
    String(value || "")
      .split(/\r?\n/)
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )].slice(0, 20);
}

function urlLooksValid(value = "") {
  if (!String(value || "").trim()) return true;
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function normalizeAddress(value = {}) {
  return {
    line1: String(value.line1 || "").trim(),
    line2: String(value.line2 || "").trim(),
    city: String(value.city || "").trim(),
    state: String(value.state || "").trim(),
    postalCode: String(value.postalCode || "").trim(),
    country: String(value.country || "United States").trim() || "United States"
  };
}

function formatAddress(address = {}) {
  const normalized = normalizeAddress(address);
  const secondLine = [normalized.city, normalized.state, normalized.postalCode]
    .filter(Boolean)
    .join(", ");
  return [normalized.line1, normalized.line2, secondLine, normalized.country]
    .filter(Boolean)
    .join(" • ");
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to process image file."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to process image file."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function extensionFromMime(mimeType = "") {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return "jpg";
}

async function dataUrlToBlob(dataUrl = "") {
  const response = await fetch(String(dataUrl || ""));
  if (!response.ok) {
    throw new Error("Unable to process local image data.");
  }
  return response.blob();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to process image preview."));
    reader.readAsDataURL(blob);
  });
}

async function optimizeImageFile(
  file,
  {
    maxWidth = 1600,
    maxHeight = 1200,
    maxBytes = 2 * 1024 * 1024,
    preferredMime = "image/jpeg",
    quality = 0.86,
    minQuality = 0.55
  } = {}
) {
  const image = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to process image file.");
  context.drawImage(image, 0, 0, width, height);

  let mime = preferredMime;
  let outputQuality = quality;
  let result = await canvasToBlob(canvas, mime, outputQuality);

  if (result.size <= maxBytes) return result;

  if (mime !== "image/jpeg") {
    mime = "image/jpeg";
    outputQuality = Math.min(outputQuality, 0.88);
    result = await canvasToBlob(canvas, mime, outputQuality);
  }

  while (result.size > maxBytes && outputQuality > minQuality) {
    outputQuality = Math.max(minQuality, outputQuality - 0.08);
    result = await canvasToBlob(canvas, "image/jpeg", outputQuality);
  }

  if (result.size > maxBytes) {
    throw new Error("Image is still too large after optimization. Please use a smaller file.");
  }

  return result;
}

function DirectorCreateAccountClerkGate() {
  const { isReady, isAuthenticated, user } = useAuth();
  const hasWizardAccess = Boolean(
    isAuthenticated &&
      (user?.roles?.includes("tenant_admin") || user?.roles?.includes("super_admin"))
  );

  if (!isReady) {
    return (
      <section className="app-status-shell">
        <div className="app-status-card">
          <h1>Loading your account...</h1>
          <p>We are syncing your director access.</p>
        </div>
      </section>
    );
  }

  if (!hasWizardAccess) {
    return <DirectorCreateAccountClerkPage />;
  }

  return <DirectorCreateAccountWizardPage />;
}

export default function DirectorCreateAccountPage() {
  if (clerkModeRequested() && !clerkUiEnabled()) {
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Create Network</h1>
          <p>{clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}</p>
          <p>
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
          </p>
        </div>
      </section>
    );
  }

  if (clerkUiEnabled()) {
    return <DirectorCreateAccountClerkGate />;
  }

  return <DirectorCreateAccountWizardPage />;
}

function DirectorCreateAccountWizardPage() {
  const { slug: paramSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, token: authToken, user } = useAuth();
  const { tenant } = useTenant();
  const slug = String(paramSlug || tenant?.slug || "").trim().toLowerCase();
  const isDirectorUser =
    user?.roles?.includes("tenant_admin") || user?.roles?.includes("super_admin");
  const accountStepRequired = !isDirectorUser;
  const initialBrandColor = useMemo(() => DEFAULT_SETUP_BRAND, []);

  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();
  const [step, setStep] = useState(() => (accountStepRequired ? STEP_ACCOUNT : STEP_DESIGN));
  const [submitError, setSubmitError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [logoFileName, setLogoFileName] = useState("");
  const [heroFileName, setHeroFileName] = useState("");
  const [showLaunchCelebration, setShowLaunchCelebration] = useState(false);
  const [launchRedirectUrl, setLaunchRedirectUrl] = useState("");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    campName: "",
    billingPlanCode: "legacy"
  });
  const [errors, setErrors] = useState({});
  const [themeErrors, setThemeErrors] = useState({});
  const [themeDraft, setThemeDraft] = useState({
    brandPrimary: DEFAULT_SETUP_BRAND,
    logoUrl: "",
    heroImageUrl: ""
  });
  const [hasCustomMainColor, setHasCustomMainColor] = useState(false);
  const [modulesDraft, setModulesDraft] = useState({
    ...DEFAULT_FEATURE_MODULES
  });
  const [newsletterName, setNewsletterName] = useState("");
  const [campSpecifics, setCampSpecifics] = useState({
    ageGroupsText: DEFAULT_AGE_GROUPS.join("\n"),
    staffRolesText: DEFAULT_STAFF_ROLES.join("\n"),
    homepageQuote: "",
    merchShopUrl: ""
  });
  const [billingDetails, setBillingDetails] = useState({
    sameAsMailing: true,
    mailingAddress: { ...EMPTY_ADDRESS },
    billingAddress: { ...EMPTY_ADDRESS }
  });
  const [billingErrors, setBillingErrors] = useState({});
  const [legalAgreementAccepted, setLegalAgreementAccepted] = useState(false);
  const [legalAgreementError, setLegalAgreementError] = useState("");
  const [specificsErrors, setSpecificsErrors] = useState({});
  const [showNewsletterSettings, setShowNewsletterSettings] = useState(false);
  const campSpecificsHydratedRef = useRef(false);
  const planHydratedRef = useRef(false);
  const initialThemeVarsRef = useRef(null);
  const skipAccountHydratedRef = useRef(false);

  const cardRef = useRef(null);

  useEffect(() => {
    if (cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [step]);

  useEffect(() => {
    if (skipAccountHydratedRef.current) return;
    if (accountStepRequired) return;

    skipAccountHydratedRef.current = true;
    setStep((currentStep) => (currentStep === STEP_ACCOUNT ? STEP_DESIGN : currentStep));
  }, [accountStepRequired]);

  useEffect(() => {
    if (!isDirectorUser) return;

    const identityEmail = String(user?.email || "").trim();
    const fullName = String(user?.name || "").trim();
    const [firstFromName = "", ...restName] = fullName ? fullName.split(/\s+/) : [];
    const lastFromName = restName.join(" ").trim();
    const tenantName = String(tenant?.name || "").trim();

    setForm((prev) => ({
      ...prev,
      firstName: prev.firstName || firstFromName,
      lastName: prev.lastName || lastFromName,
      email: prev.email || identityEmail,
      campName: prev.campName || tenantName
    }));
  }, [isDirectorUser, tenant?.name, user?.email, user?.name]);

  useEffect(() => {
    if (!showLaunchCelebration || !launchRedirectUrl) return;
    const timer = setTimeout(() => {
      if (launchRedirectUrl.startsWith("http")) {
        window.location.assign(launchRedirectUrl);
      } else {
        navigate(launchRedirectUrl);
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [showLaunchCelebration, launchRedirectUrl, navigate]);

  const backPath = inviteToken
    ? `/t/${slug}/director-claim?token=${encodeURIComponent(inviteToken)}`
    : `/t/${slug}/director-claim`;
  const loginPath = inviteToken
    ? `/t/${slug}/login?inviteToken=${encodeURIComponent(inviteToken)}`
    : `/t/${slug}/login`;
  const firstWizardStep = accountStepRequired ? STEP_ACCOUNT : STEP_DESIGN;
  const draftMainColor = isHexColor(themeDraft.brandPrimary)
    ? themeDraft.brandPrimary
    : initialBrandColor;
  const effectiveMainColor =
    step === STEP_ACCOUNT
      ? initialBrandColor
      : hasCustomMainColor
      ? draftMainColor
      : initialBrandColor;

  const selectedBillingPlanCode = normalizeBillingPlanCode(form.billingPlanCode);
  const selectedBillingPlan = BILLING_PLAN_OPTIONS.find((item) => item.code === selectedBillingPlanCode) || BILLING_PLAN_OPTIONS[0];
  const billingStatus = String(tenant?.billingStatus || "").trim().toLowerCase();
  const onboardingFeeAmount = Number(
    tenant?.onboardingFeeAmount ?? selectedBillingPlan.onboardingFeeAmount ?? 0
  );
  const onboardingFeePaid = Boolean(tenant?.onboardingFeePaid);
  const checkoutInProgress =
    String(tenant?.billingLifecycleStatus || tenant?.billing?.lifecycleStatus || "")
      .trim()
      .toLowerCase() === "checkout_started";
  const onboardingFeeStatusText =
    onboardingFeeAmount <= 0 || onboardingFeePaid
      ? "Paid or waived in Stripe"
      : checkoutInProgress
      ? "Checkout started — awaiting Stripe confirmation"
      : billingStatus === "active" || billingStatus === "trialing"
      ? "Pending Stripe payment"
      : "Billing setup required";
  const provisionedDomainPreview = String(
    tenant?.network?.domain || tenant?.customDomain || defaultTenantDomain(slug)
  )
    .trim()
    .toLowerCase();
  const enabledFeatureLabels = FEATURE_OPTIONS.filter((item) => Boolean(modulesDraft[item.key])).map(
    (item) => item.title
  );
  const reviewAgeGroups = parseLineList(campSpecifics.ageGroupsText);
  const reviewStaffRoles = parseLineList(campSpecifics.staffRolesText);
  const normalizedMailingAddress = normalizeAddress(billingDetails.mailingAddress);
  const normalizedBillingAddress = billingDetails.sameAsMailing
    ? normalizedMailingAddress
    : normalizeAddress(billingDetails.billingAddress);

  useEffect(() => {
    const root = document.documentElement;
    if (!initialThemeVarsRef.current) {
      initialThemeVarsRef.current = {
        poBrand: root.style.getPropertyValue("--po-brand"),
        poBrandStrong: root.style.getPropertyValue("--po-brand-strong"),
        brandPrimary: root.style.getPropertyValue("--brand-primary")
      };
    }

    root.style.setProperty("--po-brand", effectiveMainColor);
    root.style.setProperty("--po-brand-strong", darkenHex(effectiveMainColor));
    root.style.setProperty("--brand-primary", effectiveMainColor);
  }, [effectiveMainColor, tenant?.id, tenant?.slug, tenant?.theme?.brandPrimary]);

  useEffect(
    () => () => {
      const root = document.documentElement;
      const previous = initialThemeVarsRef.current;
      if (!previous) return;

      if (previous.poBrand) root.style.setProperty("--po-brand", previous.poBrand);
      else root.style.removeProperty("--po-brand");

      if (previous.poBrandStrong) root.style.setProperty("--po-brand-strong", previous.poBrandStrong);
      else root.style.removeProperty("--po-brand-strong");

      if (previous.brandPrimary) root.style.setProperty("--brand-primary", previous.brandPrimary);
      else root.style.removeProperty("--brand-primary");
    },
    []
  );

  useEffect(() => {
    const source = tenant?.theme || {};
    setThemeDraft((prev) => ({
      brandPrimary: String(hasCustomMainColor ? prev.brandPrimary : initialBrandColor),
      logoUrl: String(source.logoUrl || prev.logoUrl || ""),
      heroImageUrl: String(source.heroImageUrl || prev.heroImageUrl || "")
    }));
  }, [hasCustomMainColor, initialBrandColor, tenant?.theme?.logoUrl, tenant?.theme?.heroImageUrl]);

  useEffect(() => {
    const sourceName = String(tenant?.content?.newsletterName || "").trim();
    if (sourceName) {
      setNewsletterName((prev) => prev || sourceName);
    }
  }, [tenant?.content?.newsletterName]);

  useEffect(() => {
    if (!tenant || planHydratedRef.current) return;
    const billingPlanCode = normalizeBillingPlanCode(
      tenant?.billingPlan ||
        tenant?.billing?.billingPlan ||
        (String(tenant?.planTier || "").trim().toLowerCase() === "premium" ? "institutional" : "legacy")
    );
    setForm((prev) => ({ ...prev, billingPlanCode }));
    planHydratedRef.current = true;
  }, [tenant]);

  useEffect(() => {
    if (!tenant || campSpecificsHydratedRef.current) return;
    const sourceAgeGroups = Array.isArray(tenant?.content?.ageGroups)
      ? tenant.content.ageGroups
      : [];
    const sourceStaffRoles = Array.isArray(tenant?.content?.staffRoles)
      ? tenant.content.staffRoles
      : [];

    const ageGroups = sourceAgeGroups
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const staffRoles = sourceStaffRoles
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    setCampSpecifics({
      ageGroupsText: (ageGroups.length ? ageGroups : DEFAULT_AGE_GROUPS).join("\n"),
      staffRolesText: (staffRoles.length ? staffRoles : DEFAULT_STAFF_ROLES).join("\n"),
      homepageQuote: String(tenant?.content?.welcomeBody || "").trim(),
      merchShopUrl: String(tenant?.content?.merchShopUrl || "").trim()
    });
    campSpecificsHydratedRef.current = true;
  }, [tenant]);

  const draftHydratedRef = useRef(false);
  useEffect(() => {
    if (draftHydratedRef.current) return;
    draftHydratedRef.current = true;

    const localDraft = readWizardDraft(slug);
    if (localDraft) {
      setForm((prev) => ({
        ...prev,
        firstName: localDraft.firstName || prev.firstName,
        lastName: localDraft.lastName || prev.lastName,
        email: localDraft.email || prev.email,
        campName: localDraft.campName || prev.campName,
        billingPlanCode: normalizeBillingPlanCode(localDraft.billingPlanCode || prev.billingPlanCode)
      }));
    }

    const draft = tenant?.onboardingDraft;
    if (!draft) return;

    if (draft.theme?.brandPrimary && isHexColor(draft.theme.brandPrimary)) {
      setThemeDraft((prev) => ({
        brandPrimary: draft.theme.brandPrimary || prev.brandPrimary,
        logoUrl: draft.theme.logoUrl || prev.logoUrl,
        heroImageUrl: draft.theme.heroImageUrl || prev.heroImageUrl
      }));
      setHasCustomMainColor(true);
    }
    if (draft.modules) {
      const m = draft.modules;
      const hasAnyKey = Object.keys(DEFAULT_FEATURE_MODULES).some(
        (k) => typeof m[k] === "boolean"
      );
      if (hasAnyKey) {
        setModulesDraft((prev) => ({ ...prev, ...m }));
      }
    }
    if (draft.content) {
      const c = draft.content;
      if (c.newsletterName) setNewsletterName(c.newsletterName);
      if (c.ageGroups?.length || c.staffRoles?.length || c.welcomeBody || c.merchShopUrl) {
        setCampSpecifics((prev) => ({
          ageGroupsText: c.ageGroups?.length ? c.ageGroups.join("\n") : prev.ageGroupsText,
          staffRolesText: c.staffRoles?.length ? c.staffRoles.join("\n") : prev.staffRolesText,
          homepageQuote: c.welcomeBody || prev.homepageQuote,
          merchShopUrl: c.merchShopUrl ?? prev.merchShopUrl
        }));
      }
    }
    if (draft.billingDetails) {
      const bd = draft.billingDetails;
      setBillingDetails((prev) => ({
        sameAsMailing: bd.sameAsMailing ?? prev.sameAsMailing,
        mailingAddress: bd.mailingAddress?.line1
          ? { ...EMPTY_ADDRESS, ...bd.mailingAddress }
          : prev.mailingAddress,
        billingAddress: bd.billingAddress?.line1
          ? { ...EMPTY_ADDRESS, ...bd.billingAddress }
          : prev.billingAddress
      }));
    }
  }, [slug, tenant?.onboardingDraft]);

  function saveDraftForStep(completedStep) {
    if (completedStep === STEP_ACCOUNT) {
      writeWizardDraft(slug, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        campName: form.campName,
        billingPlanCode: form.billingPlanCode
      });
      return;
    }

    const token = authToken;
    if (!token) return;

    const payload = {};
    if (completedStep === STEP_DESIGN) {
      payload.theme = {
        brandPrimary: themeDraft.brandPrimary,
        brandSecondary: deriveSecondaryHex(themeDraft.brandPrimary),
        logoUrl: themeDraft.logoUrl,
        heroImageUrl: themeDraft.heroImageUrl
      };
    } else if (completedStep === STEP_FEATURES) {
      payload.modules = { ...modulesDraft };
      payload.content = { newsletterName: String(newsletterName || "").trim() || "Newsletter" };
    } else if (completedStep === STEP_CAMP_SPECIFICS) {
      payload.content = {
        ageGroups: parseLineList(campSpecifics.ageGroupsText),
        staffRoles: parseLineList(campSpecifics.staffRolesText),
        welcomeBody: campSpecifics.homepageQuote,
        merchShopUrl: campSpecifics.merchShopUrl
      };
    } else if (completedStep === STEP_BILLING_PLAN) {
      payload.billingDetails = {
        sameAsMailing: Boolean(billingDetails.sameAsMailing),
        mailingAddress: normalizeAddress(billingDetails.mailingAddress),
        billingAddress: billingDetails.sameAsMailing
          ? normalizeAddress(billingDetails.mailingAddress)
          : normalizeAddress(billingDetails.billingAddress)
      };
    }

    if (Object.keys(payload).length === 0) return;

    requestJson("/api/tenants/me/onboarding/draft", {
      method: "PATCH",
      token,
      body: payload
    }).catch(() => {});
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
    setSubmitError("");
  }

  function updateThemeField(field, value) {
    if (field === "brandPrimary") {
      setHasCustomMainColor(true);
    }
    setThemeDraft((prev) => ({ ...prev, [field]: value }));
    setThemeErrors((prev) => ({ ...prev, [field]: "" }));
    setSubmitError("");
  }

  async function uploadBrandingAsset({ blob, fileName, fileType, scope, token = "" }) {
    const authTokenForUpload = String(token || "").trim();
    const useAuthenticatedUpload = Boolean(authTokenForUpload);
    const presign = await requestJson(
      useAuthenticatedUpload ? `/api/t/${slug}/uploads/presign` : `/api/t/${slug}/uploads/presign-public`,
      {
        method: "POST",
        ...(useAuthenticatedUpload ? { token: authTokenForUpload } : {}),
        body: {
          fileName,
          fileType,
          fileSize: Number(blob?.size || 0),
          scope
        }
      }
    );

    const headers =
      presign?.headers && typeof presign.headers === "object" ? presign.headers : undefined;
    const uploadResponse = await fetch(String(presign?.uploadUrl || ""), {
      method: "PUT",
      ...(headers ? { headers } : {}),
      body: blob
    });

    if (!uploadResponse.ok) {
      throw new Error("Upload failed.");
    }

    const objectUrl = String(presign?.objectUrl || presign?.publicUrl || "").trim();
    if (!objectUrl) {
      throw new Error("Upload succeeded but no object URL was returned.");
    }

    return objectUrl;
  }

  function validateAccountStep() {
    if (!accountStepRequired) {
      return {};
    }

    const next = {};
    if (!String(form.firstName || "").trim()) next.firstName = "Please enter your first name.";
    if (!String(form.lastName || "").trim()) next.lastName = "Please enter your last name.";

    const email = String(form.email || "").trim().toLowerCase();
    if (!email) next.email = "Please enter your email address.";
    else if (!emailLooksValid(email)) next.email = "Enter a valid email address.";

    if (!String(form.password || "")) next.password = "Please create a password.";
    else if (String(form.password).length < 8) next.password = "Password must be at least 8 characters.";

    if (!String(form.confirmPassword || "")) next.confirmPassword = "Please confirm your password.";
    else if (form.password !== form.confirmPassword) next.confirmPassword = "Passwords do not match.";

    if (!String(form.campName || "").trim()) next.campName = "Please enter your camp name.";
    if (!BILLING_PLAN_OPTIONS.some((item) => item.code === normalizeBillingPlanCode(form.billingPlanCode))) {
      next.billingPlanCode = "Please choose a plan.";
    }
    return next;
  }

  function validateDesignStep() {
    const next = {};
    if (!isHexColor(themeDraft.brandPrimary)) {
      next.brandPrimary = `Use a valid color like ${initialBrandColor.toUpperCase()}.`;
    }
    return next;
  }

  function validateFeaturesStep() {
    return {};
  }

  function validateCampSpecificsStep() {
    const next = {};
    const ageGroups = parseLineList(campSpecifics.ageGroupsText);
    const staffRoles = parseLineList(campSpecifics.staffRolesText);
    const homepageQuote = String(campSpecifics.homepageQuote || "").trim();
    const merchShopUrl = String(campSpecifics.merchShopUrl || "").trim();

    if (!ageGroups.length) {
      next.ageGroupsText = "Add at least one age group name.";
    }
    if (!staffRoles.length) {
      next.staffRolesText = "Add at least one staff role name.";
    }
    if (!homepageQuote) {
      next.homepageQuote = "Add the quote shown on your pre-login homepage.";
    }
    if (modulesDraft.merchShop && merchShopUrl && !urlLooksValid(merchShopUrl)) {
      next.merchShopUrl = "Enter a valid URL starting with http:// or https://";
    }

    return { errors: next, ageGroups, staffRoles, homepageQuote, merchShopUrl };
  }

  function validateBillingStep() {
    const next = {};
    const mailingAddress = normalizeAddress(billingDetails.mailingAddress);
    const billingAddress = billingDetails.sameAsMailing
      ? { ...mailingAddress }
      : normalizeAddress(billingDetails.billingAddress);
    const requiredFields = ["line1", "city", "state", "postalCode", "country"];

    requiredFields.forEach((field) => {
      if (!String(mailingAddress[field] || "").trim()) {
        next[`mailingAddress.${field}`] = "This field is required.";
      }
    });

    if (!billingDetails.sameAsMailing) {
      requiredFields.forEach((field) => {
        if (!String(billingAddress[field] || "").trim()) {
          next[`billingAddress.${field}`] = "This field is required.";
        }
      });
    }

    return {
      errors: next,
      billingDetails: {
        sameAsMailing: Boolean(billingDetails.sameAsMailing),
        mailingAddress,
        billingAddress
      }
    };
  }

  function onContinueToDesign(event) {
    event.preventDefault();
    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setSubmitError("Please complete the required account fields to continue.");
      return;
    }
    setSubmitError("");
    saveDraftForStep(STEP_ACCOUNT);
    setStep(STEP_DESIGN);
  }

  function onContinueToFeatures(event) {
    event.preventDefault();
    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(firstWizardStep);
      setSubmitError("Please complete the required account fields before moving forward.");
      return;
    }

    setSubmitError("");
    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) {
      setSubmitError("Please fix the design fields before moving forward.");
      return;
    }
    saveDraftForStep(STEP_DESIGN);
    setStep(STEP_FEATURES);
  }

  function onContinueToCampSpecifics(event) {
    event.preventDefault();

    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(firstWizardStep);
      setSubmitError("Please complete the required account fields before moving forward.");
      return;
    }

    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) {
      setStep(STEP_DESIGN);
      setSubmitError("Please fix the design fields before moving forward.");
      return;
    }

    const nextFeatureErrors = validateFeaturesStep();
    if (Object.keys(nextFeatureErrors).length > 0) {
      setSubmitError("Please review your feature selection before continuing.");
      return;
    }

    setSubmitError("");
    saveDraftForStep(STEP_FEATURES);
    setStep(STEP_CAMP_SPECIFICS);
  }

  function onContinueToBillingPlan(event) {
    event.preventDefault();

    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(firstWizardStep);
      setSubmitError("Please complete the required account fields before moving forward.");
      return;
    }

    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) {
      setStep(STEP_DESIGN);
      setSubmitError("Please fix the design fields before moving forward.");
      return;
    }

    const nextFeatureErrors = validateFeaturesStep();
    if (Object.keys(nextFeatureErrors).length > 0) {
      setStep(STEP_FEATURES);
      setSubmitError("Please review your feature selection before moving forward.");
      return;
    }

    const specificsCheck = validateCampSpecificsStep();
    setSpecificsErrors(specificsCheck.errors);
    if (Object.keys(specificsCheck.errors).length > 0) {
      setSubmitError("Please complete camp specifics before moving forward.");
      return;
    }

    setSubmitError("");
    saveDraftForStep(STEP_CAMP_SPECIFICS);
    setStep(STEP_BILLING_PLAN);
  }

  function onContinueToReviewLaunch(event) {
    event.preventDefault();

    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(firstWizardStep);
      setSubmitError("Please complete the required account fields before moving forward.");
      return;
    }

    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) {
      setStep(STEP_DESIGN);
      setSubmitError("Please fix the design fields before moving forward.");
      return;
    }

    const nextFeatureErrors = validateFeaturesStep();
    if (Object.keys(nextFeatureErrors).length > 0) {
      setStep(STEP_FEATURES);
      setSubmitError("Please review your feature selection before moving forward.");
      return;
    }

    const specificsCheck = validateCampSpecificsStep();
    setSpecificsErrors(specificsCheck.errors);
    if (Object.keys(specificsCheck.errors).length > 0) {
      setStep(STEP_CAMP_SPECIFICS);
      setSubmitError("Please complete camp specifics before moving forward.");
      return;
    }

    const billingCheck = validateBillingStep();
    setBillingErrors(billingCheck.errors);
    if (Object.keys(billingCheck.errors).length > 0) {
      setStep(STEP_BILLING_PLAN);
      setSubmitError("Please complete billing details before moving forward.");
      return;
    }

    setSubmitError("");
    saveDraftForStep(STEP_BILLING_PLAN);
    setStep(STEP_REVIEW_LAUNCH);
  }

  async function onLogoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSubmitError("Logo upload only supports image files.");
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setSubmitError("Logo file must be under 12MB.");
      return;
    }

    setLogoFileName(file.name);
    setSubmitError("");
    try {
      const preferredMime = file.type === "image/png" ? "image/png" : "image/jpeg";
      const optimizedLogo = await optimizeImageFile(file, {
        maxWidth: 800,
        maxHeight: 800,
        maxBytes: 900 * 1024,
        preferredMime,
        quality: 0.9,
        minQuality: 0.55
      });
      const finalMime = optimizedLogo.type || preferredMime;
      const extension = finalMime === "image/png" ? "png" : "jpg";
      const uploadToken = String(authToken || "").trim();
      const logoUrl =
        uploadToken
          ? await uploadBrandingAsset({
              blob: optimizedLogo,
              fileName: `logo-${Date.now()}.${extension}`,
              fileType: finalMime,
              scope: "branding-logo",
              token: uploadToken
            })
          : await blobToDataUrl(optimizedLogo);
      updateThemeField("logoUrl", logoUrl);
    } catch (error) {
      setSubmitError(error.message || "Unable to process logo image.");
    }
  }

  async function onHeroUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSubmitError("Main photo upload only supports image files.");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setSubmitError("Main photo must be under 15MB.");
      return;
    }

    setHeroFileName(file.name);
    setSubmitError("");
    try {
      const optimizedHero = await optimizeImageFile(file, {
        maxWidth: 2200,
        maxHeight: 1400,
        maxBytes: 2 * 1024 * 1024,
        preferredMime: "image/jpeg",
        quality: 0.85,
        minQuality: 0.52
      });
      const finalMime = optimizedHero.type || "image/jpeg";
      const extension = finalMime === "image/png" ? "png" : "jpg";
      const uploadToken = String(authToken || "").trim();
      const heroImageUrl =
        uploadToken
          ? await uploadBrandingAsset({
              blob: optimizedHero,
              fileName: `hero-${Date.now()}.${extension}`,
              fileType: finalMime,
              scope: "branding-hero",
              token: uploadToken
            })
          : await blobToDataUrl(optimizedHero);
      updateThemeField("heroImageUrl", heroImageUrl);
    } catch (error) {
      setSubmitError(error.message || "Unable to process main photo.");
    }
  }

  function updateModule(moduleKey, enabled) {
    setModulesDraft((prev) => ({ ...prev, [moduleKey]: enabled }));
    if (moduleKey === "newsletter" && !enabled) {
      setShowNewsletterSettings(false);
    }
    setSubmitError("");
  }

  function updateNewsletter(value) {
    setNewsletterName(value);
    setSubmitError("");
  }

  function updateCampSpecificsField(field, value) {
    setCampSpecifics((prev) => ({ ...prev, [field]: value }));
    setSpecificsErrors((prev) => ({ ...prev, [field]: "" }));
    setSubmitError("");
  }

  function updateBillingAddressField(section, field, value) {
    setBillingDetails((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
    setBillingErrors((prev) => ({ ...prev, [`${section}.${field}`]: "" }));
    setSubmitError("");
  }

  function updateSameAsMailing(enabled) {
    setBillingDetails((prev) => ({
      ...prev,
      sameAsMailing: Boolean(enabled)
    }));
    setBillingErrors((prev) => {
      if (!enabled) return prev;
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith("billingAddress.")) delete next[key];
      });
      return next;
    });
    setSubmitError("");
  }

  function goToStep(targetStep) {
    const currentIndex = STEP_ORDER.indexOf(step);
    const targetIndex = STEP_ORDER.indexOf(targetStep);

    if (targetIndex <= currentIndex) {
      setSubmitError("");
      setStep(targetStep);
      return;
    }

    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(firstWizardStep);
      setSubmitError("Complete account details before continuing.");
      return;
    }

    if (targetIndex >= STEP_ORDER.indexOf(STEP_FEATURES)) {
      const nextThemeErrors = validateDesignStep();
      setThemeErrors(nextThemeErrors);
      if (Object.keys(nextThemeErrors).length > 0) {
        setStep(STEP_DESIGN);
        setSubmitError("Complete design details before continuing.");
        return;
      }
    }

    if (targetIndex >= STEP_ORDER.indexOf(STEP_CAMP_SPECIFICS)) {
      const nextFeatureErrors = validateFeaturesStep();
      if (Object.keys(nextFeatureErrors).length > 0) {
        setStep(STEP_FEATURES);
        setSubmitError("Complete feature selections before continuing.");
        return;
      }
    }

    if (targetIndex >= STEP_ORDER.indexOf(STEP_BILLING_PLAN)) {
      const specificsCheck = validateCampSpecificsStep();
      setSpecificsErrors(specificsCheck.errors);
      if (Object.keys(specificsCheck.errors).length > 0) {
        setStep(STEP_CAMP_SPECIFICS);
        setSubmitError("Complete camp specifics before continuing.");
        return;
      }
    }

    if (targetIndex >= STEP_ORDER.indexOf(STEP_REVIEW_LAUNCH)) {
      const billingCheck = validateBillingStep();
      setBillingErrors(billingCheck.errors);
      if (Object.keys(billingCheck.errors).length > 0) {
        setStep(STEP_BILLING_PLAN);
        setSubmitError("Complete billing details before continuing.");
        return;
      }
    }

    setSubmitError("");
    setStep(targetStep);
  }

  function stepClass(targetStep) {
    const currentIndex = STEP_ORDER.indexOf(step);
    const targetIndex = STEP_ORDER.indexOf(targetStep);
    if (targetIndex === currentIndex) return "active";
    if (targetIndex < currentIndex) return "done";
    return "";
  }

  async function onCompleteSetup(event) {
    event.preventDefault();

    const accountErrors = validateAccountStep();
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setSubmitError("Please complete your account details before finishing setup.");
      setStep(firstWizardStep);
      return;
    }

    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) return;

    const nextFeatureErrors = validateFeaturesStep();
    if (Object.keys(nextFeatureErrors).length > 0) return;

    const specificsCheck = validateCampSpecificsStep();
    setSpecificsErrors(specificsCheck.errors);
    if (Object.keys(specificsCheck.errors).length > 0) {
      setStep(STEP_CAMP_SPECIFICS);
      setSubmitError("Please complete camp specifics before finishing setup.");
      return;
    }

    const billingCheck = validateBillingStep();
    setBillingErrors(billingCheck.errors);
    if (Object.keys(billingCheck.errors).length > 0) {
      setStep(STEP_BILLING_PLAN);
      setSubmitError("Please complete billing details before finishing setup.");
      return;
    }

    if (!legalAgreementAccepted) {
      setLegalAgreementError("You must accept Terms, Agreements, and Privacy before launch.");
      setStep(STEP_REVIEW_LAUNCH);
      setSubmitError("Accept legal agreements before launching your network.");
      return;
    }

    setFinishing(true);
    setSubmitError("");
    setLegalAgreementError("");

    try {
      let token = authToken;
      if (!isDirectorUser) {
        const registerPayload = await requestJson(`/api/t/${slug}/auth/register`, {
          method: "POST",
          body: {
            firstName: String(form.firstName || "").trim(),
            lastName: String(form.lastName || "").trim(),
            email: String(form.email || "").trim().toLowerCase(),
            password: form.password,
            campName: String(form.campName || "").trim(),
            directorSignup: true
          }
        });
        token = registerPayload.token;
        login(registerPayload.token, registerPayload.user);
      }

      if (!token) {
        throw new Error("Unable to complete setup. Please sign in again.");
      }

      const baseTheme = tenant?.theme || {};
      const finalCampName = String(form.campName || tenant?.name || "").trim();
      const finalNewsletterName = String(newsletterName || "").trim() || "Newsletter";
      const finalAgeGroups = specificsCheck.ageGroups;
      const finalStaffRoles = specificsCheck.staffRoles;
      const finalHomepageQuote = specificsCheck.homepageQuote;
      const finalMerchShopUrl = specificsCheck.merchShopUrl;
      const finalPrimaryColor = String(themeDraft.brandPrimary || initialBrandColor);
      let finalLogoUrl = String(themeDraft.logoUrl || "");
      let finalHeroImageUrl = String(themeDraft.heroImageUrl || "");

      if (finalLogoUrl.startsWith("data:")) {
        const logoBlob = await dataUrlToBlob(finalLogoUrl);
        const logoMime = logoBlob.type || "image/jpeg";
        finalLogoUrl = await uploadBrandingAsset({
          blob: logoBlob,
          fileName: `logo-${Date.now()}.${extensionFromMime(logoMime)}`,
          fileType: logoMime,
          scope: "branding-logo",
          token
        });
      }

      if (finalHeroImageUrl.startsWith("data:")) {
        const heroBlob = await dataUrlToBlob(finalHeroImageUrl);
        const heroMime = heroBlob.type || "image/jpeg";
        finalHeroImageUrl = await uploadBrandingAsset({
          blob: heroBlob,
          fileName: `hero-${Date.now()}.${extensionFromMime(heroMime)}`,
          fileType: heroMime,
          scope: "branding-hero",
          token
        });
      }

      if (
        finalLogoUrl !== String(themeDraft.logoUrl || "") ||
        finalHeroImageUrl !== String(themeDraft.heroImageUrl || "")
      ) {
        setThemeDraft((prev) => ({
          ...prev,
          logoUrl: finalLogoUrl,
          heroImageUrl: finalHeroImageUrl
        }));
      }

      await requestJson("/api/tenants/me/theme", {
        method: "PATCH",
        token,
        body: {
          theme: {
            brandPrimary: finalPrimaryColor,
            brandSecondary: deriveSecondaryHex(finalPrimaryColor),
            logoUrl: finalLogoUrl,
            brandAccent: String(baseTheme.brandAccent || "#f2b134"),
            bg: String(baseTheme.bg || "#f5f7fa"),
            text: String(baseTheme.text || "#0f172a"),
            card: String(baseTheme.card || "#ffffff"),
            heroImageUrl: finalHeroImageUrl,
            fontFamily: String(baseTheme.fontFamily || "Inter"),
            fontToken: String(baseTheme.fontToken || "cedar_default")
          }
        }
      });

      await requestJson("/api/tenants/me/modules", {
        method: "PATCH",
        token,
        body: {
          modules: {
            directory: Boolean(modulesDraft.directory),
            search: Boolean(modulesDraft.search),
            photoStream: Boolean(modulesDraft.photoStream),
            chat: Boolean(modulesDraft.chat),
            map: Boolean(modulesDraft.map),
            familyTrees: Boolean(modulesDraft.familyTrees),
            relatedProfiles: Boolean(modulesDraft.relatedProfiles),
            newsletter: Boolean(modulesDraft.newsletter),
            merchShop: Boolean(modulesDraft.merchShop)
          }
        }
      });

      await requestJson("/api/tenants/me/content", {
        method: "PATCH",
        token,
        body: {
          content: {
            networkDisplayName: `${finalCampName} Alumni Network`,
            welcomeHeadline: `Welcome to ${finalCampName} Alumni Network`,
            welcomeBody: finalHomepageQuote,
            aboutText: `${finalCampName} alumni can reconnect, share memories, and support each other.`,
            contactEmail: String(form.email || "").trim().toLowerCase(),
            newsletterName: finalNewsletterName,
            ageGroups: finalAgeGroups,
            staffRoles: finalStaffRoles,
            merchShopUrl: finalMerchShopUrl
          }
        }
      });

      await requestJson("/api/tenants/me/billing", {
        method: "PATCH",
        token,
        body: {
          billingDetails: billingCheck.billingDetails
        }
      });

      const billingSnapshot = await requestJson("/api/tenants/me/billing", { token });
      const billingState = billingSnapshot?.billing || {};
      const launchReady = Boolean(
        billingState.launchReady ||
          (billingState.launchReadiness?.lifecycleReady &&
            billingState.launchReadiness?.feeReady)
      );

      if (!launchReady) {
        const lifecycleStatus = String(billingState.lifecycleStatus || "").trim().toLowerCase();
        if (checkoutQueryState === "success" && lifecycleStatus === "checkout_started") {
          throw new Error(
            "Stripe is still confirming your payment. Please wait a few seconds and click Complete setup again."
          );
        }

        const successUrl = `${window.location.origin}/t/${slug}/director-create-account?checkout=success`;
        const cancelUrl = `${window.location.origin}/t/${slug}/director-create-account?checkout=cancel`;
        const checkoutPayload = await requestJson("/api/tenants/me/billing/checkout", {
          method: "POST",
          token,
          body: {
            planCode: selectedBillingPlanCode,
            successUrl,
            cancelUrl
          }
        });
        const checkoutUrl = String(checkoutPayload?.checkoutUrl || "").trim();
        if (!checkoutUrl) {
          throw new Error("Unable to start Stripe checkout right now. Please try again.");
        }
        window.location.assign(checkoutUrl);
        return;
      }

      const launchPayload = await requestJson("/api/tenants/me/launch", {
        method: "POST",
        token,
        body: {
          mode: "director_wizard",
          legalAgreementAccepted: true,
          termsVersion: DEFAULT_TERMS_VERSION,
          privacyVersion: DEFAULT_PRIVACY_VERSION
        }
      });

      clearWizardDraft(slug);

      const launchLoginUrl = String(launchPayload?.network?.loginUrl || "").trim();
      const isLocalHost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.endsWith(".localhost");

      const redirectTarget =
        launchLoginUrl && !isLocalHost
          ? launchLoginUrl
          : `/t/${slug}/onboarding?launched=1`;

      setLaunchRedirectUrl(redirectTarget);
      setShowLaunchCelebration(true);
    } catch (error) {
      const blockers = Array.isArray(error?.payload?.error?.details?.blockers)
        ? error.payload.error.details.blockers
        : [];
      if (blockers.length > 0) {
        const blockerText = blockers.map((item) => item.label).filter(Boolean).join(", ");
        setSubmitError(`Launch blocked. Complete: ${blockerText}`);
        return;
      }
      setSubmitError(error.message || "Unable to complete setup right now.");
    } finally {
      setFinishing(false);
    }
  }

  function handleCelebrationContinue() {
    if (launchRedirectUrl.startsWith("http")) {
      window.location.assign(launchRedirectUrl);
    } else {
      navigate(launchRedirectUrl);
    }
  }

  if (showLaunchCelebration) {
    return (
      <div className="director-celebration-overlay">
        <div className="director-celebration-card">
          <div className="director-celebration-burst" aria-hidden="true" />
          <h1 className="director-celebration-title">Your network is live!</h1>
          <p className="director-celebration-camp">
            {form.campName || "Your Camp"} Alumni Network
          </p>
          <p className="director-celebration-domain">{provisionedDomainPreview}</p>
          <button
            type="button"
            className="wizard1-btn-primary director-celebration-cta"
            onClick={handleCelebrationContinue}
          >
            Go to Launch Center
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="product-claim-page product-director-create-page">
      <div className="product-claim-wrap product-director-create-wrap">
        <article ref={cardRef} className="product-claim-card product-director-create-card pb-cedar-page">
          <div className="director-create-stepper" aria-label="Onboarding progress">
            {accountStepRequired ? (
              <button
                type="button"
                className={`director-step-pill ${stepClass(STEP_ACCOUNT)}`}
                onClick={() => goToStep(STEP_ACCOUNT)}
              >
                1. Account
              </button>
            ) : null}
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_DESIGN)}`}
              onClick={() => goToStep(STEP_DESIGN)}
            >
              {accountStepRequired ? "2. Design" : "1. Design"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_FEATURES)}`}
              onClick={() => goToStep(STEP_FEATURES)}
            >
              {accountStepRequired ? "3. Features" : "2. Features"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_CAMP_SPECIFICS)}`}
              onClick={() => goToStep(STEP_CAMP_SPECIFICS)}
            >
              {accountStepRequired ? "4. Camp specifics" : "3. Camp specifics"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_BILLING_PLAN)}`}
              onClick={() => goToStep(STEP_BILLING_PLAN)}
            >
              {accountStepRequired ? "5. Billing and plan" : "4. Billing and plan"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_REVIEW_LAUNCH)}`}
              onClick={() => goToStep(STEP_REVIEW_LAUNCH)}
            >
              {accountStepRequired ? "6. Review and launch" : "5. Review and launch"}
            </button>
          </div>

          <div className="director-step-content" key={step}>
          {step === STEP_ACCOUNT ? (
            <>
              <h1>Create your director account</h1>
              <p className="product-claim-body director-create-subtitle">
                This will be your admin login for setting up and managing your camp&apos;s network.
              </p>

              <form className="director-create-form" onSubmit={onContinueToDesign} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields">
                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-first-name">
                      First name<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-first-name"
                      className={`wizard1-input ${errors.firstName ? "has-error" : ""}`}
                      value={form.firstName}
                      onChange={(event) => updateField("firstName", event.target.value)}
                      autoComplete="given-name"
                    />
                    {errors.firstName ? <p className="wizard1-error">{errors.firstName}</p> : null}
                  </div>

                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-last-name">
                      Last name<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-last-name"
                      className={`wizard1-input ${errors.lastName ? "has-error" : ""}`}
                      value={form.lastName}
                      onChange={(event) => updateField("lastName", event.target.value)}
                      autoComplete="family-name"
                    />
                    {errors.lastName ? <p className="wizard1-error">{errors.lastName}</p> : null}
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-email">
                      Email<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-email"
                      type="email"
                      className={`wizard1-input ${errors.email ? "has-error" : ""}`}
                      value={form.email}
                      onChange={(event) => updateField("email", event.target.value)}
                      autoComplete="email"
                    />
                    {errors.email ? <p className="wizard1-error">{errors.email}</p> : null}
                  </div>

                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-password">
                      Password<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-password"
                      type="password"
                      className={`wizard1-input ${errors.password ? "has-error" : ""}`}
                      value={form.password}
                      onChange={(event) => updateField("password", event.target.value)}
                      autoComplete="new-password"
                    />
                    {errors.password ? <p className="wizard1-error">{errors.password}</p> : null}
                  </div>

                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-confirm-password">
                      Confirm password<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-confirm-password"
                      type="password"
                      className={`wizard1-input ${errors.confirmPassword ? "has-error" : ""}`}
                      value={form.confirmPassword}
                      onChange={(event) => updateField("confirmPassword", event.target.value)}
                      autoComplete="new-password"
                    />
                    {errors.confirmPassword ? (
                      <p className="wizard1-error">{errors.confirmPassword}</p>
                    ) : null}
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-camp-name">
                      Camp name<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <input
                      id="director-camp-name"
                      className={`wizard1-input ${errors.campName ? "has-error" : ""}`}
                      value={form.campName}
                      onChange={(event) => updateField("campName", event.target.value)}
                    />
                    {errors.campName ? <p className="wizard1-error">{errors.campName}</p> : null}
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label">
                      Choose alumni network plan<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <div className="director-plan-grid" role="radiogroup" aria-label="Choose alumni network plan">
                      {BILLING_PLAN_OPTIONS.map((option) => (
                        <label
                          key={option.code}
                          className={`director-plan-card ${
                            selectedBillingPlanCode === option.code ? "active" : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name="director-billing-plan"
                            value={option.code}
                            checked={selectedBillingPlanCode === option.code}
                            onChange={(event) => updateField("billingPlanCode", event.target.value)}
                          />
                          <div className="director-plan-copy">
                            <strong>{option.title}</strong>
                            <span>{option.summary}</span>
                            <span>
                              {formatMoney(option.annualAmount)}/year
                              {" · "}
                              {option.onboardingFeeAmount > 0
                                ? `${formatMoney(option.onboardingFeeAmount)} onboarding fee`
                                : "No onboarding fee"}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                    {errors.billingPlanCode ? <p className="wizard1-error">{errors.billingPlanCode}</p> : null}
                  </div>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() => navigate(backPath)}
                    disabled={finishing}
                  >
                    Back
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-account-next-btn"
                      disabled={finishing}
                    >
                      Continue to design
                    </button>
                  </div>
                </div>
              </form>

              <p className="director-create-login-line">
                Already have an account? <Link to={loginPath}>Log in</Link>
              </p>
            </>
          ) : null}

          {step === STEP_DESIGN ? (
            <>
              <div className="director-design-head director-design-head--styled">
                <div className="director-design-intro">
                  <h1>Design your network</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Choose your camp colors and logo. This styling will be applied across your alumni network.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToFeatures} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-design-fields">
                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-brand-primary">
                      Main color<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <div className="director-color-row">
                      <input
                        id="director-brand-primary"
                        type="color"
                        className="director-color-swatch"
                        value={themeDraft.brandPrimary}
                        onChange={(event) => updateThemeField("brandPrimary", event.target.value)}
                        aria-label="Main color picker"
                      />
                      <input
                        className={`wizard1-input ${themeErrors.brandPrimary ? "has-error" : ""}`}
                        value={themeDraft.brandPrimary}
                        onChange={(event) => updateThemeField("brandPrimary", event.target.value)}
                        placeholder={initialBrandColor.toUpperCase()}
                      />
                    </div>
                    {themeErrors.brandPrimary ? (
                      <p className="wizard1-error">{themeErrors.brandPrimary}</p>
                    ) : null}
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-logo-upload">
                      Logo upload
                    </label>
                    <label className="director-upload-control" htmlFor="director-logo-upload">
                      <span className="director-upload-button">Upload logo</span>
                      <span className="director-upload-name">
                        {logoFileName || "PNG or JPG (optimized automatically)"}
                      </span>
                    </label>
                    <input
                      id="director-logo-upload"
                      type="file"
                      accept="image/*"
                      className="director-upload-input"
                      onChange={onLogoUpload}
                    />
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-main-photo-upload">
                      Main photo
                    </label>
                    <label className="director-upload-control" htmlFor="director-main-photo-upload">
                      <span className="director-upload-button">Upload main photo</span>
                      <span className="director-upload-name">
                        {heroFileName || "Used on login and home pages. PNG or JPG (optimized automatically)"}
                      </span>
                    </label>
                    <input
                      id="director-main-photo-upload"
                      type="file"
                      accept="image/*"
                      className="director-upload-input"
                      onChange={onHeroUpload}
                    />
                  </div>

                  <div className="wizard1-span-12">
                    <p className="wizard1-label">Live preview</p>
                    <div className="director-live-preview-frame">
                      <div
                        className="director-live-preview"
                        style={{
                          "--preview-brand": isHexColor(themeDraft.brandPrimary)
                            ? themeDraft.brandPrimary
                            : initialBrandColor,
                          "--preview-brand-dark": darkenHex(
                            isHexColor(themeDraft.brandPrimary)
                              ? themeDraft.brandPrimary
                              : initialBrandColor
                          ),
                          "--preview-secondary": deriveSecondaryHex(
                            isHexColor(themeDraft.brandPrimary)
                              ? themeDraft.brandPrimary
                              : initialBrandColor
                          ),
                          "--preview-hero": themeDraft.heroImageUrl
                            ? `url("${themeDraft.heroImageUrl}")`
                            : "none"
                        }}
                      >
                        <div className="director-live-preview-nav">
                          {themeDraft.logoUrl ? (
                            <img
                              src={themeDraft.logoUrl}
                              alt=""
                              className="director-live-preview-logo"
                            />
                          ) : (
                            <span className="director-live-preview-logo-placeholder" />
                          )}
                          <strong>{form.campName || "Your Camp"} Alumni Network</strong>
                        </div>

                        <div className="director-live-preview-hero" />

                        <div className="director-live-preview-welcome">
                          <div className="director-live-preview-welcome-left">
                            <h3>Welcome to {form.campName || "Your Camp"} Alumni Network</h3>
                            <p>
                              {campSpecifics.homepageQuote ||
                                "Reconnect with your camp community."}
                            </p>
                            <div className="director-live-preview-actions">
                              <span className="director-live-preview-btn-primary">Sign in</span>
                              <span className="director-live-preview-btn-secondary">
                                Create account
                              </span>
                            </div>
                          </div>
                          <div className="director-live-preview-pulse">
                            <span className="director-live-preview-pulse-head">Network Pulse</span>
                            <div className="director-live-preview-pulse-pills">
                              <span>0 Members</span>
                              <span>0 Photos</span>
                            </div>
                          </div>
                        </div>

                        <div className="director-live-preview-quickactions">
                          {FEATURE_OPTIONS.filter((item) => modulesDraft[item.key])
                            .slice(0, 4)
                            .map((item) => (
                              <span key={item.key}>{item.title}</span>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() =>
                      accountStepRequired ? setStep(STEP_ACCOUNT) : navigate(backPath)
                    }
                    disabled={finishing}
                  >
                    {accountStepRequired ? "Back" : "Back to claim page"}
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      Continue to features
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}

          {step === STEP_FEATURES ? (
            <>
              <div className="director-design-head">
                <div>
                  <h1>Choose your features</h1>
                  <p className="product-claim-body director-create-subtitle">
                    All features are on by default. Toggle any off to customize your network.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToCampSpecifics} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-feature-fields">
                  <div className="wizard1-span-12">
                    <div className="director-feature-grid">
                      {FEATURE_OPTIONS.map((item) => (
                        <div className="director-feature-item" key={item.key}>
                          <div>
                            <div className="director-feature-copy">
                              <strong>{item.title}</strong>
                              <span>{item.description}</span>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={Boolean(modulesDraft[item.key])}
                            onChange={(event) => updateModule(item.key, event.target.checked)}
                            aria-label={`Enable ${item.title}`}
                          />
                        </div>
                      ))}
                    </div>

                    {modulesDraft.newsletter ? (
                      <div className="director-newsletter-panel">
                        <button
                          type="button"
                          className="director-newsletter-toggle"
                          aria-expanded={showNewsletterSettings}
                          onClick={() => setShowNewsletterSettings((prev) => !prev)}
                        >
                          <span className="director-newsletter-toggle-title">
                            Camp newsletter name
                          </span>
                          <span className="director-newsletter-toggle-meta">
                            {showNewsletterSettings ? "Hide options" : "Set custom name"}
                          </span>
                          <span
                            className={`director-newsletter-chevron ${
                              showNewsletterSettings ? "open" : ""
                            }`}
                            aria-hidden="true"
                          >
                            ▾
                          </span>
                        </button>
                        {showNewsletterSettings ? (
                          <div className="director-newsletter-fields">
                            <input
                              id="director-newsletter-name"
                              className="wizard1-input"
                              value={newsletterName}
                              onChange={(event) => updateNewsletter(event.target.value)}
                              placeholder="Camp newsletter name"
                            />
                            <p className="director-feature-note">
                              Leave blank to keep the default label: &ldquo;Newsletter&rdquo;.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() => setStep(STEP_DESIGN)}
                    disabled={finishing}
                  >
                    Back
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      Continue to camp specifics
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}

          {step === STEP_CAMP_SPECIFICS ? (
            <>
              <div className="director-design-head">
                <div>
                  <h1>Camp specifics</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Set your camp-specific naming for age groups and staff roles.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToBillingPlan} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-specifics-fields">
                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-age-groups">
                      Age group names<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <textarea
                      id="director-age-groups"
                      className={`wizard1-input director-multiline ${specificsErrors.ageGroupsText ? "has-error" : ""}`}
                      value={campSpecifics.ageGroupsText}
                      onChange={(event) => updateCampSpecificsField("ageGroupsText", event.target.value)}
                      placeholder={"Super Warrior\nWarrior\nFreshman"}
                    />
                    <p className="director-field-hint">One per line. These labels appear in member profiles.</p>
                    {specificsErrors.ageGroupsText ? (
                      <p className="wizard1-error">{specificsErrors.ageGroupsText}</p>
                    ) : null}
                  </div>

                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-staff-roles">
                      Staff role names<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <textarea
                      id="director-staff-roles"
                      className={`wizard1-input director-multiline ${specificsErrors.staffRolesText ? "has-error" : ""}`}
                      value={campSpecifics.staffRolesText}
                      onChange={(event) => updateCampSpecificsField("staffRolesText", event.target.value)}
                      placeholder={"Counselor\nJC\nCIT\nAdmin"}
                    />
                    <p className="director-field-hint">One per line. Use names that match your camp structure.</p>
                    {specificsErrors.staffRolesText ? (
                      <p className="wizard1-error">{specificsErrors.staffRolesText}</p>
                    ) : null}
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-homepage-quote">
                      Homepage quote (before login)<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <textarea
                      id="director-homepage-quote"
                      className={`wizard1-input director-multiline director-quote-input ${specificsErrors.homepageQuote ? "has-error" : ""}`}
                      value={campSpecifics.homepageQuote}
                      onChange={(event) => updateCampSpecificsField("homepageQuote", event.target.value)}
                      placeholder="Reconnect with bunkmates. Search for people in your industry. And remember your time Beneath the Pines."
                    />
                    <p className="director-field-hint">
                      Example from Camp Cedar: &ldquo;Reconnect with bunkmates. Search for people in your industry. And remember your time Beneath the Pines.&rdquo;
                    </p>
                    {specificsErrors.homepageQuote ? (
                      <p className="wizard1-error">{specificsErrors.homepageQuote}</p>
                    ) : null}
                  </div>

                  {modulesDraft.merchShop ? (
                    <div className="wizard1-field wizard1-span-12">
                      <label className="wizard1-label" htmlFor="director-merch-shop-url">
                        Merch shop link
                      </label>
                      <input
                        id="director-merch-shop-url"
                        type="url"
                        className={`wizard1-input ${specificsErrors.merchShopUrl ? "has-error" : ""}`}
                        value={campSpecifics.merchShopUrl}
                        onChange={(event) => updateCampSpecificsField("merchShopUrl", event.target.value)}
                        placeholder="https://shop.campspot.com/your-camp"
                      />
                      <p className="director-field-hint">
                        Example: Camp Spot storefront URL. This is shown only when Merch Shop is enabled.
                      </p>
                      {specificsErrors.merchShopUrl ? (
                        <p className="wizard1-error">{specificsErrors.merchShopUrl}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() => setStep(STEP_FEATURES)}
                    disabled={finishing}
                  >
                    Back
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      Continue to billing and plan
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}

          {step === STEP_BILLING_PLAN ? (
            <>
              <div className="director-design-head">
                <div>
                  <h1>Billing and plan</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Confirm your alumni network plan and onboarding fee status before finishing setup.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToReviewLaunch} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-billing-fields">
                  <div className="wizard1-span-12">
                    <article className="director-summary-card">
                      <h3>Selected alumni network plan</h3>
                      <p className="director-summary-main">
                        {billingPlanLabel(selectedBillingPlanCode)}
                      </p>
                      <p className="director-field-hint">
                        {formatMoney(selectedBillingPlan.annualAmount)} yearly
                        {" · "}
                        {selectedBillingPlan.onboardingFeeAmount > 0
                          ? `${formatMoney(selectedBillingPlan.onboardingFeeAmount)} onboarding fee`
                          : "No onboarding fee"}
                      </p>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card">
                      <h3>Onboarding fee status</h3>
                      <p className="director-summary-main">{onboardingFeeStatusText}</p>
                      <p className="director-field-hint">
                        Amount: {formatMoney(onboardingFeeAmount)}. Status source: Stripe billing.
                      </p>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card director-address-card">
                      <h3>Mailing address</h3>
                      <div className="wizard1-grid wizard1-gap">
                        <div className="wizard1-field wizard1-span-12">
                          <label className="wizard1-label" htmlFor="director-mailing-line1">
                            Address line 1<span className="req" aria-hidden="true"> *</span>
                          </label>
                          <input
                            id="director-mailing-line1"
                            className={`wizard1-input ${billingErrors["mailingAddress.line1"] ? "has-error" : ""}`}
                            value={billingDetails.mailingAddress.line1}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "line1", event.target.value)
                            }
                          />
                          {billingErrors["mailingAddress.line1"] ? (
                            <p className="wizard1-error">{billingErrors["mailingAddress.line1"]}</p>
                          ) : null}
                        </div>

                        <div className="wizard1-field wizard1-span-12">
                          <label className="wizard1-label" htmlFor="director-mailing-line2">
                            Address line 2
                          </label>
                          <input
                            id="director-mailing-line2"
                            className="wizard1-input"
                            value={billingDetails.mailingAddress.line2}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "line2", event.target.value)
                            }
                          />
                        </div>

                        <div className="wizard1-field wizard1-span-4">
                          <label className="wizard1-label" htmlFor="director-mailing-city">
                            City<span className="req" aria-hidden="true"> *</span>
                          </label>
                          <input
                            id="director-mailing-city"
                            className={`wizard1-input ${billingErrors["mailingAddress.city"] ? "has-error" : ""}`}
                            value={billingDetails.mailingAddress.city}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "city", event.target.value)
                            }
                          />
                          {billingErrors["mailingAddress.city"] ? (
                            <p className="wizard1-error">{billingErrors["mailingAddress.city"]}</p>
                          ) : null}
                        </div>

                        <div className="wizard1-field wizard1-span-4">
                          <label className="wizard1-label" htmlFor="director-mailing-state">
                            State / Province<span className="req" aria-hidden="true"> *</span>
                          </label>
                          <input
                            id="director-mailing-state"
                            className={`wizard1-input ${billingErrors["mailingAddress.state"] ? "has-error" : ""}`}
                            value={billingDetails.mailingAddress.state}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "state", event.target.value)
                            }
                          />
                          {billingErrors["mailingAddress.state"] ? (
                            <p className="wizard1-error">{billingErrors["mailingAddress.state"]}</p>
                          ) : null}
                        </div>

                        <div className="wizard1-field wizard1-span-4">
                          <label className="wizard1-label" htmlFor="director-mailing-postal">
                            Postal code<span className="req" aria-hidden="true"> *</span>
                          </label>
                          <input
                            id="director-mailing-postal"
                            className={`wizard1-input ${billingErrors["mailingAddress.postalCode"] ? "has-error" : ""}`}
                            value={billingDetails.mailingAddress.postalCode}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "postalCode", event.target.value)
                            }
                          />
                          {billingErrors["mailingAddress.postalCode"] ? (
                            <p className="wizard1-error">{billingErrors["mailingAddress.postalCode"]}</p>
                          ) : null}
                        </div>

                        <div className="wizard1-field wizard1-span-6">
                          <label className="wizard1-label" htmlFor="director-mailing-country">
                            Country<span className="req" aria-hidden="true"> *</span>
                          </label>
                          <input
                            id="director-mailing-country"
                            className={`wizard1-input ${billingErrors["mailingAddress.country"] ? "has-error" : ""}`}
                            value={billingDetails.mailingAddress.country}
                            onChange={(event) =>
                              updateBillingAddressField("mailingAddress", "country", event.target.value)
                            }
                          />
                          {billingErrors["mailingAddress.country"] ? (
                            <p className="wizard1-error">{billingErrors["mailingAddress.country"]}</p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card director-address-card">
                      <div className="director-address-head">
                        <h3>Billing address</h3>
                        <label className="director-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={billingDetails.sameAsMailing}
                            onChange={(event) => updateSameAsMailing(event.target.checked)}
                          />
                          <span>Use mailing address</span>
                        </label>
                      </div>

                      {!billingDetails.sameAsMailing ? (
                        <div className="wizard1-grid wizard1-gap">
                          <div className="wizard1-field wizard1-span-12">
                            <label className="wizard1-label" htmlFor="director-billing-line1">
                              Address line 1<span className="req" aria-hidden="true"> *</span>
                            </label>
                            <input
                              id="director-billing-line1"
                              className={`wizard1-input ${billingErrors["billingAddress.line1"] ? "has-error" : ""}`}
                              value={billingDetails.billingAddress.line1}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "line1", event.target.value)
                              }
                            />
                            {billingErrors["billingAddress.line1"] ? (
                              <p className="wizard1-error">{billingErrors["billingAddress.line1"]}</p>
                            ) : null}
                          </div>

                          <div className="wizard1-field wizard1-span-12">
                            <label className="wizard1-label" htmlFor="director-billing-line2">
                              Address line 2
                            </label>
                            <input
                              id="director-billing-line2"
                              className="wizard1-input"
                              value={billingDetails.billingAddress.line2}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "line2", event.target.value)
                              }
                            />
                          </div>

                          <div className="wizard1-field wizard1-span-4">
                            <label className="wizard1-label" htmlFor="director-billing-city">
                              City<span className="req" aria-hidden="true"> *</span>
                            </label>
                            <input
                              id="director-billing-city"
                              className={`wizard1-input ${billingErrors["billingAddress.city"] ? "has-error" : ""}`}
                              value={billingDetails.billingAddress.city}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "city", event.target.value)
                              }
                            />
                            {billingErrors["billingAddress.city"] ? (
                              <p className="wizard1-error">{billingErrors["billingAddress.city"]}</p>
                            ) : null}
                          </div>

                          <div className="wizard1-field wizard1-span-4">
                            <label className="wizard1-label" htmlFor="director-billing-state">
                              State / Province<span className="req" aria-hidden="true"> *</span>
                            </label>
                            <input
                              id="director-billing-state"
                              className={`wizard1-input ${billingErrors["billingAddress.state"] ? "has-error" : ""}`}
                              value={billingDetails.billingAddress.state}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "state", event.target.value)
                              }
                            />
                            {billingErrors["billingAddress.state"] ? (
                              <p className="wizard1-error">{billingErrors["billingAddress.state"]}</p>
                            ) : null}
                          </div>

                          <div className="wizard1-field wizard1-span-4">
                            <label className="wizard1-label" htmlFor="director-billing-postal">
                              Postal code<span className="req" aria-hidden="true"> *</span>
                            </label>
                            <input
                              id="director-billing-postal"
                              className={`wizard1-input ${billingErrors["billingAddress.postalCode"] ? "has-error" : ""}`}
                              value={billingDetails.billingAddress.postalCode}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "postalCode", event.target.value)
                              }
                            />
                            {billingErrors["billingAddress.postalCode"] ? (
                              <p className="wizard1-error">{billingErrors["billingAddress.postalCode"]}</p>
                            ) : null}
                          </div>

                          <div className="wizard1-field wizard1-span-6">
                            <label className="wizard1-label" htmlFor="director-billing-country">
                              Country<span className="req" aria-hidden="true"> *</span>
                            </label>
                            <input
                              id="director-billing-country"
                              className={`wizard1-input ${billingErrors["billingAddress.country"] ? "has-error" : ""}`}
                              value={billingDetails.billingAddress.country}
                              onChange={(event) =>
                                updateBillingAddressField("billingAddress", "country", event.target.value)
                              }
                            />
                            {billingErrors["billingAddress.country"] ? (
                              <p className="wizard1-error">{billingErrors["billingAddress.country"]}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <p className="director-field-hint">
                          Billing address will use the same values as your mailing address.
                        </p>
                      )}
                    </article>
                  </div>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() => setStep(STEP_CAMP_SPECIFICS)}
                    disabled={finishing}
                  >
                    Back
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      Continue to review and launch
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}

          {step === STEP_REVIEW_LAUNCH ? (
            <>
              <div className="director-design-head">
                <div>
                  <h1>Review and launch</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Review your setup details below, then complete onboarding to open your launch center.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onCompleteSetup} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-review-fields">
                  <div className="wizard1-span-6">
                    <article className="director-summary-card">
                      <h3>Account</h3>
                      <ul className="director-review-list">
                        <li>
                          <strong>Name:</strong> {`${form.firstName} ${form.lastName}`.trim() || "Not set"}
                        </li>
                        <li>
                          <strong>Email:</strong> {form.email || "Not set"}
                        </li>
                        <li>
                          <strong>Camp:</strong> {form.campName || "Not set"}
                        </li>
                        <li>
                          <strong>Plan:</strong> {billingPlanLabel(selectedBillingPlanCode)}
                        </li>
                      </ul>
                    </article>
                  </div>

                  <div className="wizard1-span-6">
                    <article className="director-summary-card">
                      <h3>Design</h3>
                      <ul className="director-review-list">
                        <li>
                          <strong>Main color:</strong> {themeDraft.brandPrimary}
                        </li>
                        <li>
                          <strong>Logo:</strong> {themeDraft.logoUrl ? "Uploaded" : "Not uploaded"}
                        </li>
                        <li>
                          <strong>Main photo:</strong> {themeDraft.heroImageUrl ? "Uploaded" : "Not uploaded"}
                        </li>
                      </ul>
                    </article>
                  </div>

                  <div className="wizard1-span-6">
                    <article className="director-summary-card">
                      <h3>Features</h3>
                      <ul className="director-review-list">
                        <li>
                          <strong>Enabled:</strong> {enabledFeatureLabels.join(", ") || "None"}
                        </li>
                        {modulesDraft.newsletter ? (
                          <li>
                            <strong>Newsletter label:</strong>{" "}
                            {String(newsletterName || "").trim() || "Newsletter"}
                          </li>
                        ) : null}
                      </ul>
                    </article>
                  </div>

                  <div className="wizard1-span-6">
                    <article className="director-summary-card">
                      <h3>Camp specifics</h3>
                      <ul className="director-review-list">
                        <li>
                          <strong>Age groups:</strong> {reviewAgeGroups.join(", ") || "Not set"}
                        </li>
                        <li>
                          <strong>Staff roles:</strong> {reviewStaffRoles.join(", ") || "Not set"}
                        </li>
                        <li>
                          <strong>Homepage quote:</strong>{" "}
                          {String(campSpecifics.homepageQuote || "").trim() || "Not set"}
                        </li>
                        {modulesDraft.merchShop ? (
                          <li>
                            <strong>Merch link:</strong>{" "}
                            {String(campSpecifics.merchShopUrl || "").trim() || "Not set"}
                          </li>
                        ) : null}
                      </ul>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card">
                      <h3>Billing and plan</h3>
                      <ul className="director-review-list">
                        <li>
                          <strong>Plan confirmed:</strong>{" "}
                          {billingPlanLabel(selectedBillingPlanCode)}
                        </li>
                        <li>
                          <strong>Onboarding fee:</strong> {formatMoney(onboardingFeeAmount)}
                        </li>
                        <li>
                          <strong>Status:</strong> {onboardingFeeStatusText}
                        </li>
                        <li>
                          <strong>Mailing address:</strong> {formatAddress(normalizedMailingAddress) || "Not set"}
                        </li>
                        <li>
                          <strong>Billing address:</strong>{" "}
                          {billingDetails.sameAsMailing
                            ? "Same as mailing address"
                            : formatAddress(normalizedBillingAddress) || "Not set"}
                        </li>
                        <li>
                          <strong>Network domain:</strong> {provisionedDomainPreview}
                        </li>
                      </ul>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card director-legal-card">
                      <h3>Terms, agreements, and privacy</h3>
                      <label className={`director-inline-checkbox ${legalAgreementError ? "has-error" : ""}`}>
                        <input
                          type="checkbox"
                          checked={legalAgreementAccepted}
                          onChange={(event) => {
                            setLegalAgreementAccepted(event.target.checked);
                            setLegalAgreementError("");
                            setSubmitError("");
                          }}
                        />
                        <span>
                          I agree to PondBridge Terms, Director Agreement, and Privacy Policy for launching this
                          network.
                        </span>
                      </label>
                      <p className="director-field-hint">
                        Required before launch. You can review{" "}
                        <Link to={`/t/${slug}/legal`}>Terms &amp; Privacy</Link>.
                      </p>
                      {legalAgreementError ? <p className="wizard1-error">{legalAgreementError}</p> : null}
                    </article>
                  </div>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <button
                    type="button"
                    className="wizard1-btn-secondary"
                    onClick={() => setStep(STEP_BILLING_PLAN)}
                    disabled={finishing}
                  >
                    Back
                  </button>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      {finishing ? "Saving..." : "Create account & open launch center"}
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}
