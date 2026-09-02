import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  alumniPluralForCampType,
  DEFAULT_TENANT_MODULES,
  defaultNetworkDisplayNameForCamp,
  heroImagePositionPresets,
  normalizeCampType,
  heroImageSizePresets,
  normalizeHeroImagePosition,
  normalizeHeroImageSize,
  replaceAlumniForCampType,
  TENANT_MODULE_CATALOG
} from "@pondbridge/shared";
import { requestJson } from "../lib/http.js";
import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import { defaultTenantDomain } from "../lib/domain.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../lib/authMode.js";
import { readWizardDraft, writeWizardDraft, clearWizardDraft } from "../lib/storage.js";
import HeroImageEditor from "../components/HeroImageEditor.jsx";
import BrandImageColorPicker from "../components/BrandImageColorPicker.jsx";
import DirectorCreateAccountClerkPage from "./DirectorCreateAccountClerkPage.jsx";
import { readableTextColorOnBrand } from "../lib/colorUtils.js";
import {
  DEFAULT_BILLING_PLAN,
  billingPlanLabel,
  buildBillingPlanOptions,
  normalizeBillingPlanCode,
  resolveTenantBillingPlanCode
} from "../lib/billingPlanCatalog.js";
import { mountEmbeddedCheckout } from "../lib/stripeEmbeddedCheckout.js";
import {
  IMAGE_OPTIMIZATION_PRESETS,
  extensionForImageMime,
  optimizeImageFile
} from "../lib/imageOptimization.js";

const STEP_ACCOUNT = "account";
const STEP_DESIGN = "design";
const STEP_FEATURES = "features";
const STEP_CAMP_SPECIFICS = "camp_specifics";
const STEP_BILLING_PLAN = "billing_plan";
const STEP_REVIEW_LAUNCH = "review_launch";
const DEFAULT_SETUP_BRAND = "#303030";
const BILLING_REQUIRED_DURING_ONBOARDING = true;

const STEP_ORDER = [
  STEP_ACCOUNT,
  STEP_DESIGN,
  STEP_FEATURES,
  STEP_CAMP_SPECIFICS,
  STEP_BILLING_PLAN,
  STEP_REVIEW_LAUNCH
];

function normalizeWizardStep(value = "", { accountStepRequired = true } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  const fallback = accountStepRequired ? STEP_ACCOUNT : STEP_DESIGN;
  if (!STEP_ORDER.includes(normalized)) return fallback;
  if (!accountStepRequired && normalized === STEP_ACCOUNT) return STEP_DESIGN;
  return normalized;
}

function truthyParam(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function legacyOnboardingStepToWizardStep(value = "", { accountStepRequired = true } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "name_branding") return STEP_DESIGN;
  if (normalized === "welcome_message") return STEP_CAMP_SPECIFICS;
  if (normalized === "signup_controls") return STEP_BILLING_PLAN;
  if (normalized === "import_alumni") return STEP_BILLING_PLAN;
  if (normalized === "modules") return STEP_FEATURES;
  if (normalized === "review_launch") return STEP_REVIEW_LAUNCH;
  return accountStepRequired ? STEP_ACCOUNT : STEP_DESIGN;
}

function resolveServerResumeStep(
  { draft = null, onboardingStep = "" } = {},
  { accountStepRequired = true } = {}
) {
  const explicit = String(draft?.wizard?.step || "").trim().toLowerCase();
  if (explicit) {
    return normalizeWizardStep(explicit, { accountStepRequired });
  }
  return normalizeWizardStep(
    legacyOnboardingStepToWizardStep(onboardingStep, { accountStepRequired }),
    { accountStepRequired }
  );
}

const DEFAULT_FEATURE_MODULES = { ...DEFAULT_TENANT_MODULES };
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
const MEMBER_TERMS_VERSION = "2026-03-04";
const MEMBER_PRIVACY_VERSION = "2026-03-04";
const DIRECTOR_CLIENT_TERMS_VERSION = "2026-03-06";
const DIRECTOR_CLIENT_PRIVACY_VERSION = "2026-03-06";
const DIRECTOR_SERVICE_AGREEMENT_VERSION = "2026-03-06";
const DEFAULT_HERO_IMAGE_POSITION = "center center";
const DEFAULT_HERO_IMAGE_SIZE = "cover";
const CAMP_TYPE_OPTIONS = [
  { value: "coed", label: "Co-ed camp" },
  { value: "all_girls", label: "All-girls camp" },
  { value: "all_boys", label: "All-boys camp" }
];
const EMPTY_ADDRESS = {
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States"
};
const HERO_POSITION_LABELS = {
  "left top": "Top left",
  "center top": "Top center",
  "right top": "Top right",
  "left center": "Center left",
  "center center": "Center",
  "right center": "Center right",
  "left bottom": "Bottom left",
  "center bottom": "Bottom center",
  "right bottom": "Bottom right"
};
const HERO_SIZE_LABELS = {
  cover: "Fill frame",
  contain: "Fit whole photo",
  auto: "Original size",
  "110%": "Slight zoom",
  "125%": "Medium zoom",
  "140%": "Close zoom"
};
const HERO_POSITION_OPTIONS = heroImagePositionPresets.map((value) => ({
  value,
  label: HERO_POSITION_LABELS[value] || value
}));
const HERO_SIZE_OPTIONS = heroImageSizePresets.map((value) => ({
  value,
  label: HERO_SIZE_LABELS[value] || value
}));

function billingLaunchReady(billingState = {}) {
  return Boolean(
    billingState?.launchReady ||
      (billingState?.launchReadiness?.lifecycleReady && billingState?.launchReadiness?.feeReady)
  );
}

function resolveLaunchRedirectTarget(launchPayload = {}, slug = "") {
  const homeUrl = String(launchPayload?.network?.homeUrl || "").trim();
  if (homeUrl) return homeUrl;

  const appUrl = String(launchPayload?.network?.appUrl || "").trim();
  if (appUrl) return appUrl;

  const loginUrl = String(launchPayload?.network?.loginUrl || "").trim();
  if (loginUrl) return loginUrl;

  const safeSlug = String(slug || "").trim().toLowerCase();
  return safeSlug ? `/t/${safeSlug}/home` : "/home";
}

const FEATURE_OPTIONS = TENANT_MODULE_CATALOG.map((module) => ({
  key: module.key,
  title: module.key === "chat" ? "Chats and Forums" : module.label,
  description: module.description
}));

function emailLooksValid(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function isHexColor(value = "") {
  return /^#([0-9a-fA-F]{6})$/.test(String(value).trim());
}

function hexToRgb(hex = "#303030") {
  if (!isHexColor(hex)) return { r: 0, g: 43, b: 92 };
  const clean = String(hex).replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}





function darkenHex(hex, factor = 0.18) {
  if (!isHexColor(hex)) return "#1c1c1c";
  const clean = String(hex).replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16));
  const darkened = channels.map((value) => Math.max(0, Math.min(255, Math.round(value * (1 - factor)))));
  return `#${darkened.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function deriveSecondaryHex(hex, blend = 0.82) {
  if (!isHexColor(hex)) return "#e6e6e6";
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

function sanitizeMoneyValue(value, fallback = 0) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) ? fallbackParsed : 0;
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

function addressHasRequiredFields(address = {}) {
  const normalized = normalizeAddress(address);
  return ["line1", "city", "state", "postalCode", "country"].every((field) =>
    Boolean(String(normalized[field] || "").trim())
  );
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

function DirectorCreateAccountClerkGate() {
  const { isReady, isAuthenticated, user, bootstrapError, clerkLoadTimedOut, retryBootstrap, logout } = useAuth();
  const hasWizardAccess = Boolean(isAuthenticated && user?.roles?.includes("tenant_admin"));

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

  if (clerkLoadTimedOut) {
    return (
      <section className="app-status-shell is-error">
        <div className="app-status-card">
          <h1>Create Network</h1>
          <p>Director auth did not finish loading, so we paused setup before it could get stuck.</p>
          <p>
            <code>{bootstrapError}</code>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="login1-btn"
              onClick={() => {
                retryBootstrap();
                window.location.reload();
              }}
            >
              Refresh and Retry
            </button>
            <button
              type="button"
              className="login1-btn login1-btn-secondary"
              onClick={() => logout()}
            >
              Sign out first
            </button>
          </div>
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
  const { isAuthenticated, isReady, login, token: authToken, user } = useAuth();
  const { tenant, markTenantLive, refreshTenant } = useTenant();
  const slug = String(paramSlug || tenant?.slug || "").trim().toLowerCase();
  const isDirectorUser = user?.roles?.includes("tenant_admin");
  const accountStepRequired = !isDirectorUser;
  const initialBrandColor = useMemo(() => DEFAULT_SETUP_BRAND, []);

  const inviteToken = String(searchParams.get("inviteToken") || searchParams.get("token") || "").trim();
  const setupRequested = truthyParam(searchParams.get("setup"));
  const resumeLoginPath = inviteToken
    ? `/t/${slug}/login?inviteToken=${encodeURIComponent(inviteToken)}`
    : `/t/${slug}/login`;
  const checkoutQueryState = String(searchParams.get("checkout") || "").trim().toLowerCase();
  const [step, setStep] = useState(() => (accountStepRequired ? STEP_ACCOUNT : STEP_DESIGN));
  const [submitError, setSubmitError] = useState("");
  const [checkoutReturnStatus, setCheckoutReturnStatus] = useState("");
  // Set once Stripe hands back a session that renders inside the wizard.
  const [embeddedCheckout, setEmbeddedCheckout] = useState(null);
  const [embeddedCheckoutError, setEmbeddedCheckoutError] = useState("");
  const [embeddedCheckoutReady, setEmbeddedCheckoutReady] = useState(false);
  const [settlingPayment, setSettlingPayment] = useState(false);
  // Once payment lands, "Back to review" would read like it discards the
  // charge, so the panel offers a retry instead.
  const [paymentSettled, setPaymentSettled] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [draftRestoredNotice, setDraftRestoredNotice] = useState("");
  const [saveLaterStatus, setSaveLaterStatus] = useState("");
  const [savingForLater, setSavingForLater] = useState(false);
  const [logoFileName, setLogoFileName] = useState("");
  const [heroFileName, setHeroFileName] = useState("");
  const [memberHeroFileName, setMemberHeroFileName] = useState("");
  const [showLaunchCelebration, setShowLaunchCelebration] = useState(false);
  const [launchRedirectUrl, setLaunchRedirectUrl] = useState("");
  const [serverOnboardingSnapshot, setServerOnboardingSnapshot] = useState(null);
  const [serverDraftLoaded, setServerDraftLoaded] = useState(false);
  const [billingCatalogPlans, setBillingCatalogPlans] = useState([]);
  // False until GET /api/tenants/me/billing answers. Until then the plan list
  // is only the local Flagship fallback, which must not be used to judge
  // whether the camp's selected plan is valid.
  const [billingCatalogLoaded, setBillingCatalogLoaded] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    campName: "",
    campType: "coed",
    billingPlanCode: "flagship"
  });
  const [errors, setErrors] = useState({});
  const [themeErrors, setThemeErrors] = useState({});
  const [themeDraft, setThemeDraft] = useState({
    brandPrimary: DEFAULT_SETUP_BRAND,
    logoUrl: "",
    heroImageUrl: "",
    heroImageUrlMember: "",
    heroImagePosition: DEFAULT_HERO_IMAGE_POSITION,
    heroImageSize: DEFAULT_HERO_IMAGE_SIZE,
    heroImagePositionLanding: DEFAULT_HERO_IMAGE_POSITION,
    heroImageSizeLanding: DEFAULT_HERO_IMAGE_SIZE,
    heroImagePositionMember: DEFAULT_HERO_IMAGE_POSITION,
    heroImageSizeMember: DEFAULT_HERO_IMAGE_SIZE
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
  const [, setBillingErrors] = useState({});
  const [legalAgreementAccepted, setLegalAgreementAccepted] = useState(false);
  const [legalAgreementError, setLegalAgreementError] = useState("");
  const [specificsErrors, setSpecificsErrors] = useState({});
  const [showNewsletterSettings, setShowNewsletterSettings] = useState(false);
  const campSpecificsHydratedRef = useRef(false);
  const campTypeHydratedRef = useRef(false);
  const planHydratedRef = useRef(false);
  const initialThemeVarsRef = useRef(null);
  const skipAccountHydratedRef = useRef(false);
  const postCheckoutLaunchAttemptedRef = useRef(false);
  const embeddedCheckoutNodeRef = useRef(null);
  const embeddedCheckoutCardRef = useRef(null);
  // Where focus was before the payment dialog took over, so closing it puts
  // the director back where they were rather than at the top of the document.
  const checkoutReturnFocusRef = useRef(null);
  const embeddedCheckoutInstanceRef = useRef(null);
  // The register step mints a token that context state has not published yet,
  // so the payment panel keeps the one it started checkout with.
  const checkoutTokenRef = useRef("");

  const cardRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [step]);

  useEffect(() => {
    if (!draftRestoredNotice) return;
    const timeoutId = window.setTimeout(() => {
      setDraftRestoredNotice("");
    }, 4500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftRestoredNotice]);

  useEffect(() => {
    if (!saveLaterStatus) return;
    const timeoutId = window.setTimeout(() => {
      setSaveLaterStatus("");
    }, 5200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [saveLaterStatus]);

  useEffect(() => {
    if (skipAccountHydratedRef.current) return;
    if (accountStepRequired) return;

    skipAccountHydratedRef.current = true;
    setStep((currentStep) => (currentStep === STEP_ACCOUNT ? STEP_DESIGN : currentStep));
  }, [accountStepRequired]);

  useEffect(() => {
    if (!setupRequested || !accountStepRequired || !slug) return;
    // A successful login can render this route before the scoped user record
    // finishes hydrating. Wait for that decision instead of letting a transient
    // anonymous render synchronously win and bounce the director back to login.
    if (!isReady || authToken || (isAuthenticated && !user?.id)) return undefined;
    if (isAuthenticated && user?.id) {
      navigate(`/t/${slug}/home`, { replace: true });
      return undefined;
    }
    const redirectTimer = window.setTimeout(() => {
      navigate(resumeLoginPath, { replace: true });
    }, 750);
    return () => window.clearTimeout(redirectTimer);
  }, [
    accountStepRequired,
    authToken,
    isAuthenticated,
    isReady,
    navigate,
    resumeLoginPath,
    setupRequested,
    slug,
    user?.id
  ]);

  useEffect(() => {
    if (!authToken || !slug) return;

    let cancelled = false;
    requestJson("/api/tenants/me/billing", { token: authToken })
      .then((snapshot) => {
        if (cancelled) return;
        const plans = Array.isArray(snapshot?.catalog?.plans) ? snapshot.catalog.plans : [];
        if (plans.length) {
          setBillingCatalogPlans(plans);
          setBillingCatalogLoaded(true);
        }
      })
      .catch(() => {
        // Leave the Flagship fallback in place for display if the catalog is
        // unreachable, but never downgrade the director's plan off the back of
        // it -- the API validates the plan code on checkout regardless.
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, slug]);

  useEffect(() => {
    if (checkoutQueryState !== "cancel") return;
    postCheckoutLaunchAttemptedRef.current = false;
    setCheckoutReturnStatus("");
    setSubmitError("Stripe checkout was canceled. Your camp is not live yet.");
  }, [checkoutQueryState]);

  useEffect(() => {
    if (checkoutQueryState !== "success" || !authToken || !slug || showLaunchCelebration) return;
    if (postCheckoutLaunchAttemptedRef.current) return;

    let cancelled = false;
    postCheckoutLaunchAttemptedRef.current = true;
    setCheckoutReturnStatus("Payment received. Finalizing your camp now...");
    setSubmitError("");
    setFinishing(true);

    const run = async () => {
      try {
        const ready = await waitForBillingLaunchReady({
          token: authToken,
          isCancelled: () => cancelled
        });

        if (ready) {
          if (!cancelled) await launchCamp({ token: authToken, redirectImmediately: true });
          return;
        }

        if (!cancelled) {
          setCheckoutReturnStatus("");
          setSubmitError(
            "Your payment went through, but launch confirmation is still syncing. Refresh in a few seconds if you are not redirected automatically."
          );
          postCheckoutLaunchAttemptedRef.current = false;
        }
      } catch (error) {
        if (!cancelled) {
          setCheckoutReturnStatus("");
          setSubmitError(error.message || "Unable to finish launch after Stripe checkout.");
          postCheckoutLaunchAttemptedRef.current = false;
        }
      } finally {
        if (!cancelled) {
          setFinishing(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [authToken, checkoutQueryState, showLaunchCelebration, slug]);

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
    if (campTypeHydratedRef.current) return;
    const sourceCampType = normalizeCampType(
      tenant?.content?.campType || tenant?.onboardingDraft?.content?.campType || ""
    );
    if (!sourceCampType) return;
    setForm((prev) => ({ ...prev, campType: sourceCampType }));
    campTypeHydratedRef.current = true;
  }, [tenant?.content?.campType, tenant?.onboardingDraft?.content?.campType]);

  useEffect(() => {
    if (!slug || !authToken || !isDirectorUser) {
      setServerOnboardingSnapshot(null);
      setServerDraftLoaded(true);
      return;
    }

    let cancelled = false;
    setServerDraftLoaded(false);

    requestJson("/api/tenants/me/onboarding", { token: authToken })
      .then((payload) => {
        if (cancelled) return;
        const tenantPayload = payload?.tenant || {};
        setServerOnboardingSnapshot({
          draft: tenantPayload.onboardingDraft || null,
          onboardingStep: String(tenantPayload.onboardingStep || "").trim().toLowerCase()
        });
      })
      .catch(() => {
        if (cancelled) return;
        setServerOnboardingSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setServerDraftLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, isDirectorUser, slug]);

  useEffect(() => {
    if (!embeddedCheckout) return undefined;

    if (typeof document !== "undefined") {
      checkoutReturnFocusRef.current = document.activeElement;
    }
    // Moving focus into the dialog is what makes it announced at all; without
    // it a screen reader stays on the review step behind the overlay.
    embeddedCheckoutCardRef.current?.focus?.();

    return () => {
      const returnTarget = checkoutReturnFocusRef.current;
      checkoutReturnFocusRef.current = null;
      if (returnTarget && typeof returnTarget.focus === "function" && returnTarget.isConnected) {
        returnTarget.focus();
      }
    };
  }, [Boolean(embeddedCheckout)]);

  // Mounts Stripe's form once the panel is on screen, and tears the iframe down
  // on unmount so leaving the step never strands it.
  useEffect(() => {
    if (!embeddedCheckout?.clientSecret) return undefined;

    let cancelled = false;
    const container = embeddedCheckoutNodeRef.current;
    if (!container) return undefined;

    setEmbeddedCheckoutReady(false);
    setEmbeddedCheckoutError("");

    mountEmbeddedCheckout({
      publishableKey: embeddedCheckout.publishableKey,
      clientSecret: embeddedCheckout.clientSecret,
      container,
      onComplete: () => {
        if (!cancelled) handleEmbeddedCheckoutComplete();
      }
    })
      .then((instance) => {
        if (cancelled) {
          try {
            instance.destroy();
          } catch {
            // Already gone.
          }
          return;
        }
        embeddedCheckoutInstanceRef.current = instance;
        setEmbeddedCheckoutReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setEmbeddedCheckoutError(
          error.message || "Could not open the payment form. Please try again."
        );
      });

    return () => {
      cancelled = true;
      teardownEmbeddedCheckout();
    };
    // Keyed on the session alone: re-running for anything else would tear down
    // a payment form the director is in the middle of filling in.
  }, [embeddedCheckout?.sessionId]);

  useEffect(() => {
    if (!showLaunchCelebration || !launchRedirectUrl) return;
    const timer = setTimeout(() => {
      if (launchRedirectUrl.startsWith("http")) {
        window.location.assign(launchRedirectUrl);
      } else {
        navigate(launchRedirectUrl);
      }
    }, 12000);
    return () => clearTimeout(timer);
  }, [showLaunchCelebration, launchRedirectUrl, navigate]);

  function redirectToLaunchTarget(target, { replace = false } = {}) {
    const destination = String(target || "").trim();
    if (!destination) return;
    if (destination.startsWith("http")) {
      if (replace) {
        window.location.replace(destination);
      } else {
        window.location.assign(destination);
      }
      return;
    }
    navigate(destination, { replace });
  }

  // Polls until Stripe's state has landed on the tenant. Reads bypass the local
  // GET memo, or every poll inside its TTL would replay the same stale answer.
  async function waitForBillingLaunchReady({
    token,
    timeoutMs = 45000,
    isCancelled = () => false
  } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (!isCancelled() && Date.now() < deadline) {
      const billingSnapshot = await requestJson("/api/tenants/me/billing", {
        token,
        cache: "no-store"
      });
      if (billingLaunchReady(billingSnapshot?.billing || {})) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    return false;
  }

  function teardownEmbeddedCheckout() {
    const instance = embeddedCheckoutInstanceRef.current;
    embeddedCheckoutInstanceRef.current = null;
    if (!instance) return;
    try {
      instance.destroy();
    } catch {
      // Stripe already tore the iframe down; nothing to clean up.
    }
  }

  function handleCheckoutPanelKeyDown(event) {
    if (event.key !== "Escape") return;
    if (settlingPayment || paymentSettled) return;
    event.stopPropagation();
    closeEmbeddedCheckout();
  }

  function closeEmbeddedCheckout() {
    teardownEmbeddedCheckout();
    setEmbeddedCheckout(null);
    setEmbeddedCheckoutReady(false);
    setEmbeddedCheckoutError("");
    setPaymentSettled(false);
  }

  // Stripe calls this the moment payment succeeds, without navigating anywhere.
  // Confirming the session server-side applies the same state the webhook
  // would, so launch does not have to wait for webhook delivery.
  async function handleEmbeddedCheckoutComplete({ isRetry = false } = {}) {
    const token = checkoutTokenRef.current || authToken;
    const sessionId = String(embeddedCheckout?.sessionId || "");

    setSettlingPayment(true);
    setEmbeddedCheckoutError("");
    setSubmitError("");
    setCheckoutReturnStatus(
      isRetry ? "Finishing your launch..." : "Payment received. Finalizing your camp now..."
    );
    setPaymentSettled(true);

    try {
      const confirmation = await requestJson("/api/tenants/me/billing/checkout/confirm", {
        method: "POST",
        token,
        body: { sessionId }
      });

      // An async payment method can still be settling; fall back to the poll.
      if (!confirmation?.launchReadiness?.ok) {
        const ready = await waitForBillingLaunchReady({ token });
        if (!ready) {
          throw new Error(
            "Stripe is still confirming your payment. Give it a few seconds and try launching again."
          );
        }
      }

      teardownEmbeddedCheckout();
      await launchCamp({ token });
    } catch (error) {
      setCheckoutReturnStatus("");
      setEmbeddedCheckoutError(
        error.message ||
          "Your payment went through, but the launch could not finish. Your card was not charged again."
      );
    } finally {
      setSettlingPayment(false);
    }
  }

  async function launchCamp({ token, redirectImmediately = false } = {}) {
    const launchPayload = await requestJson("/api/tenants/me/launch", {
      method: "POST",
      token,
      body: {
        mode: "director_wizard",
        legalAgreementAccepted: true,
        ageEligibilityConfirmed: true,
        termsVersion: DIRECTOR_CLIENT_TERMS_VERSION,
        privacyVersion: DIRECTOR_CLIENT_PRIVACY_VERSION,
        directorAgreementVersion: DIRECTOR_SERVICE_AGREEMENT_VERSION
      }
    });

    clearWizardDraft(slug);

    // The launch redirect leaves this page, and the router refuses to let a
    // director into a network whose tenant record still reads "not live". Both
    // the cached tenant payload and the server's public copy are pre-launch at
    // this point, so settle them here before navigating anywhere.
    markTenantLive?.();
    await Promise.resolve(refreshTenant?.(slug, { bypassCache: true })).catch(() => {});

    const redirectTarget = resolveLaunchRedirectTarget(launchPayload, slug);

    if (redirectImmediately) {
      redirectToLaunchTarget(redirectTarget, { replace: true });
      return launchPayload;
    }

    setLaunchRedirectUrl(redirectTarget);
    setShowLaunchCelebration(true);
    return launchPayload;
  }

  const backPath = inviteToken
    ? `/t/${slug}/director-claim?token=${encodeURIComponent(inviteToken)}`
    : `/t/${slug}/director-claim`;
  const loginPath = resumeLoginPath;
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
  const checkoutLogoUrl = String(themeDraft.logoUrl || tenant?.theme?.logoUrl || "").trim();
  const paletteSwatches = [
    { label: "Primary", color: effectiveMainColor },
    { label: "Action", color: darkenHex(effectiveMainColor, 0.12) },
    { label: "Soft", color: deriveSecondaryHex(effectiveMainColor, 0.72) },
    { label: "Surface", color: deriveSecondaryHex(effectiveMainColor, 0.9) }
  ];

  const availablePlanOptions = useMemo(
    () => buildBillingPlanOptions(billingCatalogPlans),
    [billingCatalogPlans]
  );
  const selectedBillingPlanCode = normalizeBillingPlanCode(form.billingPlanCode);
  const selectedBillingPlan =
    availablePlanOptions.find((item) => item.code === selectedBillingPlanCode) ||
    availablePlanOptions[0];
  const tenantBillingPlanCode = resolveTenantBillingPlanCode(tenant, selectedBillingPlanCode);
  const tenantBillingPlan =
    availablePlanOptions.find((item) => item.code === tenantBillingPlanCode) ||
    selectedBillingPlan;
  const hasTenantAnnualAmount = Number.isFinite(Number(tenant?.billing?.annualAmount));
  const hasTenantOnboardingFeeAmount =
    Object.prototype.hasOwnProperty.call(tenant || {}, "onboardingFeeAmount") ||
    Object.prototype.hasOwnProperty.call(tenant?.billing || {}, "onboardingFeeAmount");
  const configuredAnnualAmount = hasTenantAnnualAmount
    ? sanitizeMoneyValue(tenant?.billing?.annualAmount, tenantBillingPlan.annualAmount)
    : sanitizeMoneyValue(tenantBillingPlan.annualAmount, selectedBillingPlan.annualAmount);
  const configuredOnboardingFeeAmount = hasTenantOnboardingFeeAmount
    ? sanitizeMoneyValue(
        tenant?.onboardingFeeAmount ?? tenant?.billing?.onboardingFeeAmount,
        tenantBillingPlan.onboardingFeeAmount
      )
    : sanitizeMoneyValue(tenantBillingPlan.onboardingFeeAmount, selectedBillingPlan.onboardingFeeAmount);
  const selectedPlanAnnualAmount =
    selectedBillingPlanCode === tenantBillingPlanCode
      ? configuredAnnualAmount
      : sanitizeMoneyValue(selectedBillingPlan.annualAmount, 0);
  const selectedPlanOnboardingFeeAmount =
    selectedBillingPlanCode === tenantBillingPlanCode
      ? configuredOnboardingFeeAmount
      : sanitizeMoneyValue(selectedBillingPlan.onboardingFeeAmount, 0);
  const annualAmountForPlanOption = (planCode = "") => {
    if (normalizeBillingPlanCode(planCode) === tenantBillingPlanCode) return configuredAnnualAmount;
    const option = availablePlanOptions.find(
      (item) => item.code === normalizeBillingPlanCode(planCode)
    );
    return sanitizeMoneyValue(option?.annualAmount, 0);
  };
  const onboardingFeeAmountForPlanOption = (planCode = "") => {
    if (normalizeBillingPlanCode(planCode) === tenantBillingPlanCode) return configuredOnboardingFeeAmount;
    const option = availablePlanOptions.find(
      (item) => item.code === normalizeBillingPlanCode(planCode)
    );
    return sanitizeMoneyValue(option?.onboardingFeeAmount, 0);
  };
  const billingStatus = String(tenant?.billingStatus || tenant?.billing?.billingStatus || "")
    .trim()
    .toLowerCase();
  const onboardingFeeAmount = configuredOnboardingFeeAmount;
  const onboardingFeePaid = Boolean(tenant?.onboardingFeePaid ?? tenant?.billing?.onboardingFeePaid);
  const checkoutInProgress =
    String(tenant?.billingLifecycleStatus || tenant?.billing?.lifecycleStatus || "")
      .trim()
      .toLowerCase() === "checkout_started";
  const onboardingFeeStatusText =
    onboardingFeeAmount <= 0
      ? "No onboarding fee on this plan"
      : onboardingFeePaid
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
  const selectedCampType = normalizeCampType(form.campType || tenant?.content?.campType || "coed");
  const alumniWord = alumniPluralForCampType(selectedCampType, { capitalized: false });
  const alumniWordTitle = alumniPluralForCampType(selectedCampType, { capitalized: true });
  const networkDisplayNamePreview = defaultNetworkDisplayNameForCamp(
    form.campName || String(tenant?.name || "").trim() || "Your Camp",
    selectedCampType
  );
  const networkPreviewInitials =
    networkDisplayNamePreview
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "CN";
  const featureOptionsForCopy = useMemo(
    () =>
      FEATURE_OPTIONS.map((item) => ({
        ...item,
        title: item.key === "map" ? `${alumniWordTitle} Location Map` : item.title,
        description: replaceAlumniForCampType(item.description, selectedCampType)
      })),
    [alumniWordTitle, selectedCampType]
  );
  const mailingAddressDraft = { ...EMPTY_ADDRESS, ...(billingDetails.mailingAddress || {}) };
  // A director who already has an account never sees the account step, so the
  // address would otherwise be skipped entirely on the resume path.
  const mailingAddressOnSpecificsStep = !accountStepRequired;
  // Rendered in the account step for a new director, and in camp specifics
  // for a returning one whose account step is skipped — either way the
  // address is collected before launch.
  const mailingAddressFields = (
      <div className="wizard1-span-12 director-address-block">
        <div className="director-address-head">
          <strong>Camp mailing address</strong>
          <span>
            Included in the footer of every email your camp sends, as anti-spam law
            requires. It is not shown on your public pages.
          </span>
        </div>

        <div className="wizard1-grid wizard1-gap">
          <div className="wizard1-field wizard1-span-12">
            <label className="wizard1-label" htmlFor="director-address-line1">
              Street address<span className="req" aria-hidden="true"> *</span>
            </label>
            <AddressAutocomplete
              id="director-address-line1"
              value={mailingAddressDraft.line1}
              hasError={Boolean(errors["mailingAddress.line1"])}
              placeholder="Start typing to search"
              onChange={(next) => updateMailingAddress({ line1: next })}
              onSelect={(picked) => updateMailingAddress(picked)}
            />
            {errors["mailingAddress.line1"] ? (
              <p className="wizard1-error">{errors["mailingAddress.line1"]}</p>
            ) : null}
          </div>

          <div className="wizard1-field wizard1-span-12">
            <label className="wizard1-label" htmlFor="director-address-line2">
              Suite, unit, or building <small>optional</small>
            </label>
            <input
              id="director-address-line2"
              className="wizard1-input"
              value={mailingAddressDraft.line2}
              onChange={(event) => updateMailingAddress({ line2: event.target.value })}
              autoComplete="address-line2"
            />
          </div>

          <div className="wizard1-field wizard1-span-6">
            <label className="wizard1-label" htmlFor="director-address-city">
              City<span className="req" aria-hidden="true"> *</span>
            </label>
            <input
              id="director-address-city"
              className={`wizard1-input ${errors["mailingAddress.city"] ? "has-error" : ""}`}
              value={mailingAddressDraft.city}
              onChange={(event) => updateMailingAddress({ city: event.target.value })}
              autoComplete="address-level2"
            />
            {errors["mailingAddress.city"] ? (
              <p className="wizard1-error">{errors["mailingAddress.city"]}</p>
            ) : null}
          </div>

          <div className="wizard1-field wizard1-span-3">
            <label className="wizard1-label" htmlFor="director-address-state">
              State<span className="req" aria-hidden="true"> *</span>
            </label>
            <input
              id="director-address-state"
              className={`wizard1-input ${errors["mailingAddress.state"] ? "has-error" : ""}`}
              value={mailingAddressDraft.state}
              onChange={(event) => updateMailingAddress({ state: event.target.value })}
              autoComplete="address-level1"
            />
            {errors["mailingAddress.state"] ? (
              <p className="wizard1-error">{errors["mailingAddress.state"]}</p>
            ) : null}
          </div>

          <div className="wizard1-field wizard1-span-3">
            <label className="wizard1-label" htmlFor="director-address-postal">
              ZIP code<span className="req" aria-hidden="true"> *</span>
            </label>
            <input
              id="director-address-postal"
              className={`wizard1-input ${errors["mailingAddress.postalCode"] ? "has-error" : ""}`}
              value={mailingAddressDraft.postalCode}
              onChange={(event) => updateMailingAddress({ postalCode: event.target.value })}
              autoComplete="postal-code"
            />
            {errors["mailingAddress.postalCode"] ? (
              <p className="wizard1-error">{errors["mailingAddress.postalCode"]}</p>
            ) : null}
          </div>

          <div className="wizard1-field wizard1-span-12">
            <label className="wizard1-label" htmlFor="director-address-country">
              Country<span className="req" aria-hidden="true"> *</span>
            </label>
            <input
              id="director-address-country"
              className={`wizard1-input ${errors["mailingAddress.country"] ? "has-error" : ""}`}
              value={mailingAddressDraft.country}
              onChange={(event) => updateMailingAddress({ country: event.target.value })}
              autoComplete="country-name"
            />
            {errors["mailingAddress.country"] ? (
              <p className="wizard1-error">{errors["mailingAddress.country"]}</p>
            ) : null}
          </div>
        </div>
      </div>
  );

  const enabledFeatureLabels = featureOptionsForCopy
    .filter((item) => Boolean(modulesDraft[item.key]))
    .map((item) => item.title);
  const reviewDirectorName = `${form.firstName} ${form.lastName}`.trim() || "Not set";
  const mainPhotoFramingLabel = `${
    HERO_POSITION_OPTIONS.find((item) => item.value === themeDraft.heroImagePositionLanding)?.label || "Center"
  } / ${
    HERO_SIZE_OPTIONS.find((item) => item.value === themeDraft.heroImageSizeLanding)?.label || "Fill frame"
  }`;
  const enabledModulesCount = enabledFeatureLabels.length;
  const designPreviewHeroStyle = themeDraft.heroImageUrl
    ? {
        backgroundImage: `url("${themeDraft.heroImageUrl}")`,
        backgroundPosition: normalizeHeroImagePosition(
          themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || "center center"
        ),
        backgroundSize: normalizeHeroImageSize(
          themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || "cover"
        )
      }
    : undefined;
  const reviewAgeGroups = parseLineList(campSpecifics.ageGroupsText);
  const reviewStaffRoles = parseLineList(campSpecifics.staffRolesText);
  useEffect(() => {
    const root = document.documentElement;
    if (!initialThemeVarsRef.current) {
      initialThemeVarsRef.current = {
        poBrand: root.style.getPropertyValue("--po-brand"),
        poBrandStrong: root.style.getPropertyValue("--po-brand-strong"),
        brandPrimary: root.style.getPropertyValue("--brand-primary"),
        brandOnPrimary: root.style.getPropertyValue("--brand-on-primary"),
        brandOnPrimaryRgb: root.style.getPropertyValue("--brand-on-primary-rgb")
      };
    }

    const brandOnPrimary = readableTextColorOnBrand(effectiveMainColor);
    const onPrimaryRgb = hexToRgb(brandOnPrimary);

    root.style.setProperty("--po-brand", effectiveMainColor);
    root.style.setProperty("--po-brand-strong", darkenHex(effectiveMainColor));
    root.style.setProperty("--brand-primary", effectiveMainColor);
    root.style.setProperty("--brand-on-primary", brandOnPrimary);
    root.style.setProperty("--brand-on-primary-rgb", `${onPrimaryRgb.r}, ${onPrimaryRgb.g}, ${onPrimaryRgb.b}`);
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

      if (previous.brandOnPrimary) root.style.setProperty("--brand-on-primary", previous.brandOnPrimary);
      else root.style.removeProperty("--brand-on-primary");

      if (previous.brandOnPrimaryRgb) root.style.setProperty("--brand-on-primary-rgb", previous.brandOnPrimaryRgb);
      else root.style.removeProperty("--brand-on-primary-rgb");
    },
    []
  );

  useEffect(() => {
    const source = tenant?.theme || {};
    setThemeDraft((prev) => ({
      brandPrimary: String(hasCustomMainColor ? prev.brandPrimary : initialBrandColor),
      logoUrl: String(source.logoUrl || prev.logoUrl || ""),
      heroImageUrl: String(source.heroImageUrl || prev.heroImageUrl || ""),
      heroImageUrlMember: String(source.heroImageUrlMember || prev.heroImageUrlMember || ""),
      heroImagePosition: normalizeHeroImagePosition(
        source.heroImagePositionLanding ||
          source.heroImagePosition ||
          prev.heroImagePositionLanding ||
          prev.heroImagePosition ||
          DEFAULT_HERO_IMAGE_POSITION
      ),
      heroImageSize: normalizeHeroImageSize(
        source.heroImageSizeLanding ||
          source.heroImageSize ||
          prev.heroImageSizeLanding ||
          prev.heroImageSize ||
          DEFAULT_HERO_IMAGE_SIZE
      ),
      heroImagePositionLanding: normalizeHeroImagePosition(
        source.heroImagePositionLanding ||
          source.heroImagePosition ||
          prev.heroImagePositionLanding ||
          prev.heroImagePosition ||
          DEFAULT_HERO_IMAGE_POSITION
      ),
      heroImageSizeLanding: normalizeHeroImageSize(
        source.heroImageSizeLanding ||
          source.heroImageSize ||
          prev.heroImageSizeLanding ||
          prev.heroImageSize ||
          DEFAULT_HERO_IMAGE_SIZE
      ),
      heroImagePositionMember: normalizeHeroImagePosition(
        source.heroImagePositionMember ||
          source.heroImagePosition ||
          prev.heroImagePositionMember ||
          prev.heroImagePosition ||
          DEFAULT_HERO_IMAGE_POSITION
      ),
      heroImageSizeMember: normalizeHeroImageSize(
        source.heroImageSizeMember ||
          source.heroImageSize ||
          prev.heroImageSizeMember ||
          prev.heroImageSize ||
          DEFAULT_HERO_IMAGE_SIZE
      )
    }));
  }, [
    hasCustomMainColor,
    initialBrandColor,
    tenant?.theme?.logoUrl,
    tenant?.theme?.heroImageUrl,
    tenant?.theme?.heroImagePosition,
    tenant?.theme?.heroImageSize,
    tenant?.theme?.heroImagePositionLanding,
    tenant?.theme?.heroImageSizeLanding,
    tenant?.theme?.heroImagePositionMember,
    tenant?.theme?.heroImageSizeMember
  ]);

  useEffect(() => {
    const sourceName = String(tenant?.content?.newsletterName || "").trim();
    if (sourceName) {
      setNewsletterName((prev) => prev || sourceName);
    }
  }, [tenant?.content?.newsletterName]);

  useEffect(() => {
    if (!tenant || planHydratedRef.current) return;
    const billingPlanCode = resolveTenantBillingPlanCode(tenant) || DEFAULT_BILLING_PLAN.code;
    setForm((prev) => ({ ...prev, billingPlanCode }));
    planHydratedRef.current = true;
  }, [tenant]);

  // If the selected plan is not one the server offers this camp, fall back to
  // the first plan it does offer so checkout never receives a rejected code.
  // Only ever judge that against a catalog the server actually returned.
  useEffect(() => {
    if (!billingCatalogLoaded || !availablePlanOptions.length) return;
    setForm((prev) => {
      const current = normalizeBillingPlanCode(prev.billingPlanCode);
      if (availablePlanOptions.some((item) => item.code === current)) return prev;
      return { ...prev, billingPlanCode: availablePlanOptions[0].code };
    });
  }, [availablePlanOptions, billingCatalogLoaded]);

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

  const localDraftHydratedRef = useRef(false);
  const serverDraftHydratedRef = useRef(false);

  useEffect(() => {
    if (!slug || localDraftHydratedRef.current) return;
    localDraftHydratedRef.current = true;

    const localDraft = readWizardDraft(slug);
    if (!localDraft) return;

    const draftForm =
      localDraft.form && typeof localDraft.form === "object" ? localDraft.form : localDraft;
    // A plan the director already picked is the most recent expression of
    // intent. The camp's stored plan is only the creation default at this point,
    // so letting it win here silently reverted a $10 internal test pick back to
    // Flagship on every reload -- and then billed Flagship at checkout.
    const draftBillingPlanCode = String(
      draftForm.billingPlanCode || draftForm.selectedPlanCode || ""
    )
      .trim()
      .toLowerCase();
    // Stop the tenant-hydration effect below from overwriting the restored pick.
    if (draftBillingPlanCode) planHydratedRef.current = true;
    setForm((prev) => ({
      ...prev,
      firstName: String(draftForm.firstName || prev.firstName || ""),
      lastName: String(draftForm.lastName || prev.lastName || ""),
      email: String(draftForm.email || prev.email || ""),
      campName: String(draftForm.campName || prev.campName || ""),
      campType: normalizeCampType(
        draftForm.campType || localDraft?.content?.campType || prev.campType || "coed"
      ),
      billingPlanCode: normalizeBillingPlanCode(
        draftBillingPlanCode || resolveTenantBillingPlanCode(tenant) || prev.billingPlanCode
      )
    }));

    if (localDraft.themeDraft && typeof localDraft.themeDraft === "object") {
      setThemeDraft((prev) => ({
        ...prev,
        brandPrimary: isHexColor(localDraft.themeDraft.brandPrimary)
          ? localDraft.themeDraft.brandPrimary
          : prev.brandPrimary,
        logoUrl: String(localDraft.themeDraft.logoUrl || prev.logoUrl || ""),
        heroImageUrl: String(localDraft.themeDraft.heroImageUrl || prev.heroImageUrl || ""),
        heroImageUrlMember: String(
          localDraft.themeDraft.heroImageUrlMember || prev.heroImageUrlMember || ""
        ),
        heroImagePosition: normalizeHeroImagePosition(
          localDraft.themeDraft.heroImagePositionLanding ||
            localDraft.themeDraft.heroImagePosition ||
            prev.heroImagePositionLanding ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSize: normalizeHeroImageSize(
          localDraft.themeDraft.heroImageSizeLanding ||
            localDraft.themeDraft.heroImageSize ||
            prev.heroImageSizeLanding ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionLanding: normalizeHeroImagePosition(
          localDraft.themeDraft.heroImagePositionLanding ||
            localDraft.themeDraft.heroImagePosition ||
            prev.heroImagePositionLanding ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeLanding: normalizeHeroImageSize(
          localDraft.themeDraft.heroImageSizeLanding ||
            localDraft.themeDraft.heroImageSize ||
            prev.heroImageSizeLanding ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionMember: normalizeHeroImagePosition(
          localDraft.themeDraft.heroImagePositionMember ||
            localDraft.themeDraft.heroImagePosition ||
            prev.heroImagePositionMember ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeMember: normalizeHeroImageSize(
          localDraft.themeDraft.heroImageSizeMember ||
            localDraft.themeDraft.heroImageSize ||
            prev.heroImageSizeMember ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        )
      }));
      if (isHexColor(localDraft.themeDraft.brandPrimary)) {
        setHasCustomMainColor(true);
      }
    }

    if (localDraft.modulesDraft && typeof localDraft.modulesDraft === "object") {
      setModulesDraft((prev) => ({
        ...prev,
        ...localDraft.modulesDraft
      }));
    }

    if (Object.prototype.hasOwnProperty.call(localDraft, "newsletterName")) {
      setNewsletterName(String(localDraft.newsletterName || ""));
    }

    if (localDraft.campSpecifics && typeof localDraft.campSpecifics === "object") {
      setCampSpecifics((prev) => ({
        ...prev,
        ageGroupsText: String(localDraft.campSpecifics.ageGroupsText || prev.ageGroupsText || ""),
        staffRolesText: String(localDraft.campSpecifics.staffRolesText || prev.staffRolesText || ""),
        homepageQuote: String(localDraft.campSpecifics.homepageQuote || prev.homepageQuote || ""),
        merchShopUrl: String(localDraft.campSpecifics.merchShopUrl || prev.merchShopUrl || "")
      }));
    }

    if (localDraft.billingDetails && typeof localDraft.billingDetails === "object") {
      setBillingDetails((prev) => ({
        sameAsMailing:
          localDraft.billingDetails.sameAsMailing === undefined
            ? prev.sameAsMailing
            : Boolean(localDraft.billingDetails.sameAsMailing),
        mailingAddress: normalizeAddress(
          localDraft.billingDetails.mailingAddress || prev.mailingAddress || EMPTY_ADDRESS
        ),
        billingAddress: normalizeAddress(
          localDraft.billingDetails.billingAddress || prev.billingAddress || EMPTY_ADDRESS
        )
      }));
    }

    setStep(normalizeWizardStep(localDraft.step, { accountStepRequired }));
    setDraftRestoredNotice("Draft restored from your previous session.");
    serverDraftHydratedRef.current = true;
  }, [accountStepRequired, slug, tenant]);

  useEffect(() => {
    if (serverDraftHydratedRef.current || !serverDraftLoaded) return;

    const draft = serverOnboardingSnapshot?.draft;
    if (!draft) return;
    serverDraftHydratedRef.current = true;

    if (draft.theme && typeof draft.theme === "object") {
      setThemeDraft((prev) => ({
        brandPrimary:
          draft.theme.brandPrimary && isHexColor(draft.theme.brandPrimary)
            ? draft.theme.brandPrimary
            : prev.brandPrimary,
        logoUrl: draft.theme.logoUrl || prev.logoUrl,
        heroImageUrl: draft.theme.heroImageUrl || prev.heroImageUrl,
        heroImagePosition: normalizeHeroImagePosition(
          draft.theme.heroImagePositionLanding ||
            draft.theme.heroImagePosition ||
            prev.heroImagePositionLanding ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSize: normalizeHeroImageSize(
          draft.theme.heroImageSizeLanding ||
            draft.theme.heroImageSize ||
            prev.heroImageSizeLanding ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionLanding: normalizeHeroImagePosition(
          draft.theme.heroImagePositionLanding ||
            draft.theme.heroImagePosition ||
            prev.heroImagePositionLanding ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeLanding: normalizeHeroImageSize(
          draft.theme.heroImageSizeLanding ||
            draft.theme.heroImageSize ||
            prev.heroImageSizeLanding ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionMember: normalizeHeroImagePosition(
          draft.theme.heroImagePositionMember ||
            draft.theme.heroImagePosition ||
            prev.heroImagePositionMember ||
            prev.heroImagePosition ||
            DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeMember: normalizeHeroImageSize(
          draft.theme.heroImageSizeMember ||
            draft.theme.heroImageSize ||
            prev.heroImageSizeMember ||
            prev.heroImageSize ||
            DEFAULT_HERO_IMAGE_SIZE
        )
      }));
      if (draft.theme.brandPrimary && isHexColor(draft.theme.brandPrimary)) {
        setHasCustomMainColor(true);
      }
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
      if (c.campType) {
        setForm((prev) => ({ ...prev, campType: normalizeCampType(c.campType, prev.campType || "coed") }));
      }
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

    setStep(
      resolveServerResumeStep(
        {
          draft,
          onboardingStep: serverOnboardingSnapshot?.onboardingStep || ""
        },
        { accountStepRequired }
      )
    );
    setDraftRestoredNotice("Draft restored from your saved progress.");
  }, [accountStepRequired, serverDraftLoaded, serverOnboardingSnapshot]);

  function buildLocalDraftSnapshot(nextStep = step) {
    const next = normalizeWizardStep(nextStep, { accountStepRequired });
    return {
      step: next,
      form: {
        firstName: String(form.firstName || "").trim(),
        lastName: String(form.lastName || "").trim(),
        email: String(form.email || "").trim().toLowerCase(),
        campName: String(form.campName || "").trim(),
        campType: normalizeCampType(form.campType || "coed"),
        billingPlanCode: normalizeBillingPlanCode(form.billingPlanCode)
      },
      themeDraft: {
        brandPrimary: isHexColor(themeDraft.brandPrimary) ? themeDraft.brandPrimary : initialBrandColor,
        logoUrl: String(themeDraft.logoUrl || ""),
        heroImageUrl: String(themeDraft.heroImageUrl || ""),
        heroImagePosition: normalizeHeroImagePosition(
          themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSize: normalizeHeroImageSize(
          themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionLanding: normalizeHeroImagePosition(
          themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeLanding: normalizeHeroImageSize(
          themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionMember: normalizeHeroImagePosition(
          themeDraft.heroImagePositionMember || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeMember: normalizeHeroImageSize(
          themeDraft.heroImageSizeMember || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        )
      },
      modulesDraft: { ...modulesDraft },
      newsletterName: String(newsletterName || ""),
      campSpecifics: {
        ageGroupsText: String(campSpecifics.ageGroupsText || ""),
        staffRolesText: String(campSpecifics.staffRolesText || ""),
        homepageQuote: String(campSpecifics.homepageQuote || ""),
        merchShopUrl: String(campSpecifics.merchShopUrl || "")
      },
      billingDetails: {
        sameAsMailing: Boolean(billingDetails.sameAsMailing),
        mailingAddress: normalizeAddress(billingDetails.mailingAddress),
        billingAddress: billingDetails.sameAsMailing
          ? normalizeAddress(billingDetails.mailingAddress)
          : normalizeAddress(billingDetails.billingAddress)
      },
      selectedPlanCode: normalizeBillingPlanCode(form.billingPlanCode)
    };
  }

  function saveLocalDraft(nextStep = step) {
    if (!slug) return;
    writeWizardDraft(slug, buildLocalDraftSnapshot(nextStep));
  }

  function buildServerDraftPatch({
    completedStep = "",
    nextStep = step,
    includeAllSections = false
  } = {}) {
    const normalizedNextStep = normalizeWizardStep(nextStep, { accountStepRequired });
    const payload = {
      wizard: {
        step: normalizedNextStep,
        savedAt: new Date().toISOString(),
        source: "director_create_account"
      }
    };

    const shouldIncludeTheme = includeAllSections || completedStep === STEP_DESIGN;
    const shouldIncludeAccount = includeAllSections || completedStep === STEP_ACCOUNT;
    const shouldIncludeFeatureChoices = includeAllSections || completedStep === STEP_FEATURES;
    const shouldIncludeCampSpecifics = includeAllSections || completedStep === STEP_CAMP_SPECIFICS;
    // The mailing address lives under billingDetails but is collected on the
    // account step (or camp specifics for a returning director), so those
    // steps have to save that section too.
    const shouldIncludeBilling =
      includeAllSections ||
      completedStep === STEP_BILLING_PLAN ||
      completedStep === STEP_ACCOUNT ||
      completedStep === STEP_CAMP_SPECIFICS;

    if (shouldIncludeTheme) {
      payload.theme = {
        brandPrimary: themeDraft.brandPrimary,
        brandSecondary: deriveSecondaryHex(themeDraft.brandPrimary),
        logoUrl: themeDraft.logoUrl,
        heroImageUrl: themeDraft.heroImageUrl,
        heroImageUrlMember: themeDraft.heroImageUrlMember,
        heroImagePosition: normalizeHeroImagePosition(
          themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSize: normalizeHeroImageSize(
          themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionLanding: normalizeHeroImagePosition(
          themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeLanding: normalizeHeroImageSize(
          themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        ),
        heroImagePositionMember: normalizeHeroImagePosition(
          themeDraft.heroImagePositionMember || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
        ),
        heroImageSizeMember: normalizeHeroImageSize(
          themeDraft.heroImageSizeMember || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
        )
      };
    }

    if (shouldIncludeAccount) {
      payload.content = {
        ...(payload.content || {}),
        campType: normalizeCampType(form.campType || "coed")
      };
    }

    if (shouldIncludeFeatureChoices) {
      payload.modules = { ...modulesDraft };
      payload.content = {
        ...(payload.content || {}),
        newsletterName: String(newsletterName || "").trim() || "Newsletter"
      };
    }

    if (shouldIncludeCampSpecifics) {
      payload.content = {
        ...(payload.content || {}),
        ageGroups: parseLineList(campSpecifics.ageGroupsText),
        staffRoles: parseLineList(campSpecifics.staffRolesText),
        welcomeBody: campSpecifics.homepageQuote,
        merchShopUrl: campSpecifics.merchShopUrl
      };
    }

    if (shouldIncludeBilling) {
      payload.billingDetails = {
        sameAsMailing: Boolean(billingDetails.sameAsMailing),
        mailingAddress: normalizeAddress(billingDetails.mailingAddress),
        billingAddress: billingDetails.sameAsMailing
          ? normalizeAddress(billingDetails.mailingAddress)
          : normalizeAddress(billingDetails.billingAddress)
      };
    }

    return payload;
  }

  function saveDraftForStep(completedStep, { nextStep = step } = {}) {
    saveLocalDraft(nextStep);

    const token = authToken;
    if (!token) return;

    const payload = buildServerDraftPatch({ completedStep, nextStep });

    requestJson("/api/tenants/me/onboarding/draft", {
      method: "PATCH",
      token,
      body: payload
    }).catch(() => {});
  }

  async function onSaveAndContinueLater() {
    saveLocalDraft(step);
    setSubmitError("");
    setSaveLaterStatus("");

    const token = String(authToken || "").trim();
    if (!token) {
      setSaveLaterStatus(
        "Draft saved on this device. Sign in on this browser to continue where you left off."
      );
      return;
    }

    setSavingForLater(true);
    try {
      await requestJson("/api/tenants/me/onboarding/draft", {
        method: "PATCH",
        token,
        body: buildServerDraftPatch({
          nextStep: step,
          includeAllSections: true
        })
      });
      setSaveLaterStatus("Progress saved. Next time you sign in, onboarding will reopen at this step.");
    } catch {
      setSaveLaterStatus("Saved on this device, but we could not sync your draft to the server.");
    } finally {
      setSavingForLater(false);
    }
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

  // Anti-spam law requires a physical address in every marketing email, so the
  // mail tools stay blocked until this is on file. Collecting it during
  // onboarding keeps that block from ever appearing.
  function validateMailingAddress() {
    const next = {};
    const mailingAddress = normalizeAddress(billingDetails.mailingAddress);
    if (!mailingAddress.line1) next["mailingAddress.line1"] = "Please enter your camp mailing address.";
    if (!mailingAddress.city) next["mailingAddress.city"] = "Please enter the city.";
    if (!mailingAddress.state) next["mailingAddress.state"] = "Please enter the state.";
    if (!mailingAddress.postalCode) next["mailingAddress.postalCode"] = "Please enter the ZIP or postal code.";
    if (!mailingAddress.country) next["mailingAddress.country"] = "Please enter the country.";
    return next;
  }

  /**
   * The address sits on the account step for a new director and on camp
   * specifics for a returning one, so a failure has to send each to the step
   * that actually shows the empty field.
   */
  function stepForAccountErrors(accountErrors = {}) {
    const keys = Object.keys(accountErrors);
    const onlyAddressMissing =
      keys.length > 0 && keys.every((key) => key.startsWith("mailingAddress."));
    if (onlyAddressMissing && mailingAddressOnSpecificsStep) return STEP_CAMP_SPECIFICS;
    return firstWizardStep;
  }

  /**
   * For a returning director the address sits on camp specifics, so it cannot
   * block a move into a step that comes before it — the director has not been
   * shown the field yet.
   */
  function mailingAddressRequiredForStep(targetStep) {
    if (!mailingAddressOnSpecificsStep) return true;
    return STEP_ORDER.indexOf(targetStep) > STEP_ORDER.indexOf(STEP_CAMP_SPECIFICS);
  }

  // Once the address is the only thing missing the director is standing on the
  // camp specifics step, where "account fields" names nothing they can see.
  function accountErrorsMessage(accountErrors, fallback) {
    const keys = Object.keys(accountErrors);
    const onlyAddressMissing =
      keys.length > 0 && keys.every((key) => key.startsWith("mailingAddress."));
    if (onlyAddressMissing && mailingAddressOnSpecificsStep) {
      return "Please add your camp mailing address to continue.";
    }
    return fallback;
  }

  function accountErrorsForStep(targetStep) {
    return validateAccountStep({
      includeMailingAddress: mailingAddressRequiredForStep(targetStep)
    });
  }

  function validateAccountStep({ includeMailingAddress = true } = {}) {
    const addressErrors = includeMailingAddress ? validateMailingAddress() : {};
    const campTypeValid = CAMP_TYPE_OPTIONS.some(
      (item) => item.value === normalizeCampType(form.campType || "")
    );
    if (!accountStepRequired) {
      return {
        ...(campTypeValid ? {} : { campType: "Please choose your camp type." }),
        ...addressErrors
      };
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
    if (!campTypeValid) {
      next.campType = "Please choose your camp type.";
    }
    if (
      billingCatalogLoaded &&
      !availablePlanOptions.some((item) => item.code === normalizeBillingPlanCode(form.billingPlanCode))
    ) {
      next.billingPlanCode = "Please choose a plan.";
    }

    return { ...next, ...addressErrors };
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
    if (modulesDraft.merchShop && !merchShopUrl) {
      next.merchShopUrl = "Add the camp merch shop URL or turn off the Merch Shop module.";
    } else if (modulesDraft.merchShop && !urlLooksValid(merchShopUrl)) {
      next.merchShopUrl = "Enter a valid URL starting with http:// or https://";
    }

    return { errors: next, ageGroups, staffRoles, homepageQuote, merchShopUrl };
  }

  function validateBillingStep() {
    const mailingAddress = normalizeAddress(billingDetails.mailingAddress);
    const billingAddress = billingDetails.sameAsMailing
      ? { ...mailingAddress }
      : normalizeAddress(billingDetails.billingAddress);

    return {
      errors: {},
      billingDetails: {
        sameAsMailing: Boolean(billingDetails.sameAsMailing),
        mailingAddress,
        billingAddress
      }
    };
  }

  function onContinueToDesign(event) {
    event.preventDefault();
    const accountErrors = accountErrorsForStep(STEP_DESIGN);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setSubmitError("Please complete the required account fields to continue.");
      return;
    }
    setSubmitError("");
    saveDraftForStep(STEP_ACCOUNT, { nextStep: STEP_DESIGN });
    setStep(STEP_DESIGN);
  }

  function onContinueToFeatures(event) {
    event.preventDefault();
    const accountErrors = accountErrorsForStep(STEP_FEATURES);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(stepForAccountErrors(accountErrors));
      setSubmitError(
        accountErrorsMessage(
          accountErrors,
          "Please complete the required account fields before moving forward."
        )
      );
      return;
    }

    setSubmitError("");
    const nextThemeErrors = validateDesignStep();
    setThemeErrors(nextThemeErrors);
    if (Object.keys(nextThemeErrors).length > 0) {
      setSubmitError("Please fix the design fields before moving forward.");
      return;
    }
    saveDraftForStep(STEP_DESIGN, { nextStep: STEP_FEATURES });
    setStep(STEP_FEATURES);
  }

  function onContinueToCampSpecifics(event) {
    event.preventDefault();

    const accountErrors = accountErrorsForStep(STEP_CAMP_SPECIFICS);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(stepForAccountErrors(accountErrors));
      setSubmitError(
        accountErrorsMessage(
          accountErrors,
          "Please complete the required account fields before moving forward."
        )
      );
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
    saveDraftForStep(STEP_FEATURES, { nextStep: STEP_CAMP_SPECIFICS });
    setStep(STEP_CAMP_SPECIFICS);
  }

  function onContinueToBillingPlan(event) {
    event.preventDefault();

    const accountErrors = accountErrorsForStep(STEP_BILLING_PLAN);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(stepForAccountErrors(accountErrors));
      setSubmitError(
        accountErrorsMessage(
          accountErrors,
          "Please complete the required account fields before moving forward."
        )
      );
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
    saveDraftForStep(STEP_CAMP_SPECIFICS, { nextStep: STEP_BILLING_PLAN });
    setStep(STEP_BILLING_PLAN);
  }

  function onContinueToReviewLaunch(event) {
    event.preventDefault();

    const accountErrors = accountErrorsForStep(STEP_REVIEW_LAUNCH);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(stepForAccountErrors(accountErrors));
      setSubmitError(
        accountErrorsMessage(
          accountErrors,
          "Please complete the required account fields before moving forward."
        )
      );
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

    if (BILLING_REQUIRED_DURING_ONBOARDING) {
      const billingCheck = validateBillingStep();
      setBillingErrors(billingCheck.errors);
      if (Object.keys(billingCheck.errors).length > 0) {
        setStep(STEP_BILLING_PLAN);
        setSubmitError("Please review billing and plan before moving forward.");
        return;
      }
    } else {
      setBillingErrors({});
    }

    setSubmitError("");
    saveDraftForStep(STEP_BILLING_PLAN, { nextStep: STEP_REVIEW_LAUNCH });
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
      const optimizedLogo = await optimizeImageFile(
        file,
        IMAGE_OPTIMIZATION_PRESETS.logo
      );
      const finalMime = optimizedLogo.type || file.type || "image/jpeg";
      const extension = extensionForImageMime(finalMime);
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
      const optimizedHero = await optimizeImageFile(
        file,
        IMAGE_OPTIMIZATION_PRESETS.hero
      );
      const finalMime = optimizedHero.type || file.type || "image/jpeg";
      const extension = extensionForImageMime(finalMime);
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

  // Optional second photo, shown only on the logged-in member home. Leaving it
  // empty keeps the member home on the main photo.
  async function onMemberHeroUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSubmitError("Member home photo upload only supports image files.");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setSubmitError("Member home photo must be under 15MB.");
      return;
    }

    setMemberHeroFileName(file.name);
    setSubmitError("");
    try {
      const optimizedHero = await optimizeImageFile(file, IMAGE_OPTIMIZATION_PRESETS.hero);
      const finalMime = optimizedHero.type || file.type || "image/jpeg";
      const extension = extensionForImageMime(finalMime);
      const uploadToken = String(authToken || "").trim();
      const memberHeroImageUrl =
        uploadToken
          ? await uploadBrandingAsset({
              blob: optimizedHero,
              fileName: `hero-member-${Date.now()}.${extension}`,
              fileType: finalMime,
              scope: "branding-hero",
              token: uploadToken
            })
          : await blobToDataUrl(optimizedHero);
      updateThemeField("heroImageUrlMember", memberHeroImageUrl);
    } catch (error) {
      setSubmitError(error.message || "Unable to process member home photo.");
    }
  }

  function onClearMemberHero() {
    setMemberHeroFileName("");
    updateThemeField("heroImageUrlMember", "");
  }

  function updateModule(moduleKey, enabled) {
    setModulesDraft((prev) => {
      const next = { ...prev, [moduleKey]: enabled };
      if (moduleKey === "directory" && !enabled) {
        next.search = false;
        next.relatedProfiles = false;
      }
      if ((moduleKey === "search" || moduleKey === "relatedProfiles") && enabled) {
        next.directory = true;
      }
      return next;
    });
    if (moduleKey === "newsletter" && !enabled) {
      setShowNewsletterSettings(false);
    }
    setSubmitError("");
  }

  function updateMailingAddress(patch = {}) {
    setBillingDetails((prev) => ({
      ...prev,
      // Merged raw rather than through normalizeAddress: trimming on every
      // keystroke would stop anyone typing a space mid-field.
      mailingAddress: { ...EMPTY_ADDRESS, ...(prev.mailingAddress || {}), ...patch }
    }));
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(patch).forEach((field) => {
        delete next[`mailingAddress.${field}`];
      });
      return next;
    });
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

  function goToStep(targetStep) {
    const currentIndex = STEP_ORDER.indexOf(step);
    const targetIndex = STEP_ORDER.indexOf(targetStep);

    if (targetIndex <= currentIndex) {
      setSubmitError("");
      saveLocalDraft(targetStep);
      setStep(targetStep);
      return;
    }

    const accountErrors = accountErrorsForStep(targetStep);
    setErrors(accountErrors);
    if (Object.keys(accountErrors).length > 0) {
      setStep(stepForAccountErrors(accountErrors));
      setSubmitError(
        accountErrorsMessage(accountErrors, "Complete account details before continuing.")
      );
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
        setSubmitError("Review billing and plan before continuing.");
        return;
      }
    }

    setSubmitError("");
    saveLocalDraft(targetStep);
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
      setSubmitError(
        accountErrorsMessage(
          accountErrors,
          "Please complete your account details before finishing setup."
        )
      );
      setStep(stepForAccountErrors(accountErrors));
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
    if (BILLING_REQUIRED_DURING_ONBOARDING) {
      setBillingErrors(billingCheck.errors);
      if (Object.keys(billingCheck.errors).length > 0) {
        setStep(STEP_BILLING_PLAN);
        setSubmitError("Please review billing and plan before finishing setup.");
        return;
      }
    } else {
      setBillingErrors({});
    }

    if (!legalAgreementAccepted) {
      setLegalAgreementError("Accept the PondBridge client legal agreements before launch.");
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
            directorSignup: true,
            legalAgreementAccepted: true,
            ageEligibilityConfirmed: true,
            termsVersion: MEMBER_TERMS_VERSION,
            privacyVersion: MEMBER_PRIVACY_VERSION,
            legalAgreement: {
              accepted: true,
              acceptedAt: new Date().toISOString(),
              termsVersion: MEMBER_TERMS_VERSION,
              privacyVersion: MEMBER_PRIVACY_VERSION,
              ageEligibilityConfirmed: true
            }
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
      let finalMemberHeroImageUrl = String(themeDraft.heroImageUrlMember || "");

      if (finalLogoUrl.startsWith("data:")) {
        const logoBlob = await dataUrlToBlob(finalLogoUrl);
        const logoMime = logoBlob.type || "image/jpeg";
        finalLogoUrl = await uploadBrandingAsset({
          blob: logoBlob,
          fileName: `logo-${Date.now()}.${extensionForImageMime(logoMime)}`,
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
          fileName: `hero-${Date.now()}.${extensionForImageMime(heroMime)}`,
          fileType: heroMime,
          scope: "branding-hero",
          token
        });
      }

      if (finalMemberHeroImageUrl.startsWith("data:")) {
        const memberHeroBlob = await dataUrlToBlob(finalMemberHeroImageUrl);
        const memberHeroMime = memberHeroBlob.type || "image/jpeg";
        finalMemberHeroImageUrl = await uploadBrandingAsset({
          blob: memberHeroBlob,
          fileName: `hero-member-${Date.now()}.${extensionForImageMime(memberHeroMime)}`,
          fileType: memberHeroMime,
          scope: "branding-hero",
          token
        });
      }

      if (
        finalLogoUrl !== String(themeDraft.logoUrl || "") ||
        finalHeroImageUrl !== String(themeDraft.heroImageUrl || "") ||
        finalMemberHeroImageUrl !== String(themeDraft.heroImageUrlMember || "")
      ) {
        setThemeDraft((prev) => ({
          ...prev,
          logoUrl: finalLogoUrl,
          heroImageUrl: finalHeroImageUrl,
          heroImageUrlMember: finalMemberHeroImageUrl
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
            bg: String(baseTheme.bg || "#fafafa"),
            text: String(baseTheme.text || "#1c1c1c"),
            card: String(baseTheme.card || "#ffffff"),
            heroImageUrl: finalHeroImageUrl,
            heroImageUrlMember: finalMemberHeroImageUrl,
            heroImagePosition: normalizeHeroImagePosition(
              themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
            ),
            heroImageSize: normalizeHeroImageSize(
              themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
            ),
            heroImagePositionLanding: normalizeHeroImagePosition(
              themeDraft.heroImagePositionLanding || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
            ),
            heroImageSizeLanding: normalizeHeroImageSize(
              themeDraft.heroImageSizeLanding || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
            ),
            heroImagePositionMember: normalizeHeroImagePosition(
              themeDraft.heroImagePositionMember || themeDraft.heroImagePosition || DEFAULT_HERO_IMAGE_POSITION
            ),
            heroImageSizeMember: normalizeHeroImageSize(
              themeDraft.heroImageSizeMember || themeDraft.heroImageSize || DEFAULT_HERO_IMAGE_SIZE
            ),
            fontFamily: String(baseTheme.fontFamily || "Inter Variable"),
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
            events: Boolean(modulesDraft.events),
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
            campType: selectedCampType,
            networkDisplayName: defaultNetworkDisplayNameForCamp(finalCampName, selectedCampType),
            welcomeHeadline: `Welcome to ${defaultNetworkDisplayNameForCamp(finalCampName, selectedCampType)}`,
            welcomeBody: finalHomepageQuote,
            aboutText: `${finalCampName} ${alumniWord} can reconnect, share memories, and support each other.`,
            contactEmail: String(form.email || "").trim().toLowerCase(),
            newsletterName: finalNewsletterName,
            ageGroups: finalAgeGroups,
            staffRoles: finalStaffRoles,
            merchShopUrl: finalMerchShopUrl
          }
        }
      });

      if (BILLING_REQUIRED_DURING_ONBOARDING) {
        const shouldPersistBillingDetails =
          addressHasRequiredFields(billingCheck.billingDetails.mailingAddress) &&
          (billingCheck.billingDetails.sameAsMailing ||
            addressHasRequiredFields(billingCheck.billingDetails.billingAddress));
        if (shouldPersistBillingDetails) {
          await requestJson("/api/tenants/me/billing", {
            method: "PATCH",
            token,
            body: {
              billingDetails: billingCheck.billingDetails
            }
          });
        }

        const billingSnapshot = await requestJson("/api/tenants/me/billing", { token });
        const billingState = billingSnapshot?.billing || {};
        const launchReady = billingLaunchReady(billingState);

        if (!launchReady) {
          const lifecycleStatus = String(billingState.lifecycleStatus || "").trim().toLowerCase();
          if (checkoutQueryState === "success" && lifecycleStatus === "checkout_started") {
            throw new Error(
              "Stripe is still confirming your payment. Please wait a few seconds and click Complete setup again."
            );
          }

          // The hosted URLs stay in the request as the fallback for any
          // environment without embedded checkout (mock billing, no
          // publishable key), so launch never dead-ends on a missing key.
          const successUrl = `${window.location.origin}/t/${slug}/director-create-account?checkout=success`;
          const cancelUrl = `${window.location.origin}/t/${slug}/director-create-account?checkout=cancel`;
          const checkoutPayload = await requestJson("/api/tenants/me/billing/checkout", {
            method: "POST",
            token,
            body: {
              planCode: selectedBillingPlanCode,
              uiMode: "embedded",
              successUrl,
              cancelUrl
            }
          });
          const checkoutAction = String(checkoutPayload?.action || "").trim().toLowerCase();
          const checkoutUrl = String(checkoutPayload?.checkoutUrl || "").trim();
          const clientSecret = String(checkoutPayload?.clientSecret || "").trim();
          const publishableKey = String(checkoutPayload?.publishableKey || "").trim();

          if (clientSecret && publishableKey) {
            // Payment happens right here; the launch resumes in
            // handleEmbeddedCheckoutComplete once Stripe reports success.
            checkoutTokenRef.current = token;
            setEmbeddedCheckout({
              clientSecret,
              publishableKey,
              sessionId: String(checkoutPayload?.sessionId || "")
            });
            return;
          }

          if (checkoutUrl) {
            window.location.assign(checkoutUrl);
            return;
          }

          if (checkoutAction === "subscription_updated" || checkoutAction === "complimentary_plan") {
            const refreshedBillingSnapshot = await requestJson("/api/tenants/me/billing", { token });
            const refreshedBillingState = refreshedBillingSnapshot?.billing || {};
            const refreshedLaunchReady = Boolean(
              refreshedBillingState.launchReady ||
                (refreshedBillingState.launchReadiness?.lifecycleReady &&
                  refreshedBillingState.launchReadiness?.feeReady)
            );
            if (!refreshedLaunchReady) {
              throw new Error(
                checkoutPayload?.notes ||
                  (checkoutAction === "complimentary_plan"
                    ? "Complimentary billing was applied, but launch readiness is still pending. Refresh and try again."
                    : "Subscription updated, but billing is still pending. Open the billing portal to finish setup.")
              );
            }
          } else {
            throw new Error(
              checkoutPayload?.notes || "Unable to start Stripe checkout right now. Please try again."
            );
          }
        }
      }

      await launchCamp({ token });
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

  const visibleStepOrder = accountStepRequired
    ? STEP_ORDER
    : STEP_ORDER.filter((item) => item !== STEP_ACCOUNT);
  const totalStepCount = visibleStepOrder.length;
  const currentStepNumber = Math.max(1, visibleStepOrder.indexOf(step) + 1);
  // What Stripe will actually charge on this checkout: the first year plus any
  // one-time onboarding fee.
  const checkoutTotalAmount = selectedPlanAnnualAmount + selectedPlanOnboardingFeeAmount;

  if (showLaunchCelebration) {
    return (
      <div className="director-celebration-overlay">
        <div className="director-celebration-card" role="dialog" aria-modal="true">
          <div className="director-celebration-burst" aria-hidden="true" />
          {checkoutLogoUrl ? (
            <img className="director-celebration-logo" src={checkoutLogoUrl} alt="" />
          ) : null}
          <h1 className="director-celebration-title">Your network is live!</h1>
          <p className="director-celebration-camp">
            {networkDisplayNamePreview}
          </p>
          <p className="director-celebration-domain">{provisionedDomainPreview}</p>
          {/* The button used to say "Go to Launch Center", but it has always
              gone to the camp's own home page. */}
          <button
            type="button"
            className="wizard1-btn-primary director-celebration-cta"
            onClick={handleCelebrationContinue}
          >
            Go to your network
          </button>
          <p className="director-celebration-autonote">
            Taking you there automatically in a few seconds.
          </p>
        </div>
      </div>
    );
  }

  // Payment lives inside the wizard: Stripe's form mounts in this panel, so the
  // director never leaves the page and there is no state to restore afterwards.
  if (embeddedCheckout) {
    return (
      <div className="director-checkout-overlay">
        <div
          className="director-checkout-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="director-checkout-title"
          aria-describedby="director-checkout-plan"
          ref={embeddedCheckoutCardRef}
          tabIndex={-1}
          onKeyDown={handleCheckoutPanelKeyDown}
        >
          <header className="director-checkout-head">
            {checkoutLogoUrl ? (
              <img className="director-checkout-logo" src={checkoutLogoUrl} alt="" />
            ) : null}
            <p className="director-checkout-camp">{networkDisplayNamePreview}</p>
            <h1 className="director-checkout-title" id="director-checkout-title">
              Complete your payment
            </h1>
            {/* The charge is the most consequential thing on this screen, so it
                is the one element sized to be read first. */}
            <p className="director-checkout-amount">
              <span className="director-checkout-amount-value">
                {formatMoney(checkoutTotalAmount)}
              </span>
              <span className="director-checkout-amount-period">
                {selectedPlanOnboardingFeeAmount > 0 ? "due today" : "per year"}
              </span>
            </p>
            <p className="director-checkout-plan" id="director-checkout-plan">
              {billingPlanLabel(selectedBillingPlanCode, availablePlanOptions)}
              {selectedPlanOnboardingFeeAmount > 0
                ? ` · ${formatMoney(selectedPlanAnnualAmount)} per year plus a one-time ${formatMoney(
                    selectedPlanOnboardingFeeAmount
                  )} onboarding fee`
                : " · billed annually, no onboarding fee"}
            </p>
          </header>

          <div aria-live="polite">
            {settlingPayment ? (
              <p className="director-checkout-status">Payment received. Launching your network...</p>
            ) : !embeddedCheckoutReady && !embeddedCheckoutError ? (
              <p className="director-checkout-status">Loading the secure Stripe payment form...</p>
            ) : null}
          </div>

          {embeddedCheckoutError ? (
            <p className="wizard1-error director-checkout-error" role="alert">
              {embeddedCheckoutError}
            </p>
          ) : null}

          <div
            className={`director-checkout-frame ${
              embeddedCheckoutReady || paymentSettled ? "is-ready" : "is-loading"
            }`}
            ref={embeddedCheckoutNodeRef}
          />

          <div className="director-checkout-actions">
            {paymentSettled ? (
              <button
                type="button"
                className="wizard1-btn-primary"
                onClick={() => handleEmbeddedCheckoutComplete({ isRetry: true })}
                disabled={settlingPayment}
              >
                {settlingPayment ? "Launching..." : "Retry launch"}
              </button>
            ) : (
              <button
                type="button"
                className="wizard1-btn-secondary"
                onClick={closeEmbeddedCheckout}
                disabled={settlingPayment}
              >
                Back to review
              </button>
            )}
            {paymentSettled ? (
              <p className="director-checkout-secure">
                Your payment is complete. Retrying only finishes the launch.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="product-claim-page product-director-create-page">
      <div
        className={`product-claim-wrap product-director-create-wrap ${
          step === STEP_DESIGN || step === STEP_REVIEW_LAUNCH ? "is-design-studio" : ""
        }`}
      >
        <article ref={cardRef} className="product-claim-card product-director-create-card pb-cedar-page">
          {/* The wizard sits outside the app shell, so without this the only
              thing naming the camp is the browser tab, while every other
              director surface shows it. */}
          <header className="director-wizard-identity">
            <div className="director-wizard-identity-main">
              {checkoutLogoUrl ? (
                <img className="director-wizard-identity-logo" src={checkoutLogoUrl} alt="" />
              ) : (
                <span className="director-wizard-identity-mark" aria-hidden="true">
                  {networkPreviewInitials}
                </span>
              )}
              <div>
                <p className="director-wizard-identity-kicker">Director setup</p>
                <p className="director-wizard-identity-name">{networkDisplayNamePreview}</p>
              </div>
            </div>
            <p className="director-wizard-identity-progress">
              Step {currentStepNumber} of {totalStepCount}
            </p>
          </header>
          <div
            className="director-wizard-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalStepCount}
            aria-valuenow={currentStepNumber}
            aria-label="Setup progress"
          >
            <span
              className="director-wizard-progress-fill"
              style={{ width: `${Math.round((currentStepNumber / totalStepCount) * 100)}%` }}
            />
          </div>
          <div className="director-create-stepper" aria-label="Onboarding progress">
            {accountStepRequired ? (
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_ACCOUNT)}`}
              onClick={() => goToStep(STEP_ACCOUNT)}
              aria-current={step === STEP_ACCOUNT ? "step" : undefined}
            >
                1. Account
              </button>
            ) : null}
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_DESIGN)}`}
              onClick={() => goToStep(STEP_DESIGN)}
              aria-current={step === STEP_DESIGN ? "step" : undefined}
            >
              {accountStepRequired ? "2. Design" : "1. Design"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_FEATURES)}`}
              onClick={() => goToStep(STEP_FEATURES)}
              aria-current={step === STEP_FEATURES ? "step" : undefined}
            >
              {accountStepRequired ? "3. Features" : "2. Features"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_CAMP_SPECIFICS)}`}
              onClick={() => goToStep(STEP_CAMP_SPECIFICS)}
              aria-current={step === STEP_CAMP_SPECIFICS ? "step" : undefined}
            >
              {accountStepRequired ? "4. Camp specifics" : "3. Camp specifics"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_BILLING_PLAN)}`}
              onClick={() => goToStep(STEP_BILLING_PLAN)}
              aria-current={step === STEP_BILLING_PLAN ? "step" : undefined}
            >
              {accountStepRequired ? "5. Billing and plan" : "4. Billing and plan"}
            </button>
            <button
              type="button"
              className={`director-step-pill ${stepClass(STEP_REVIEW_LAUNCH)}`}
              onClick={() => goToStep(STEP_REVIEW_LAUNCH)}
              aria-current={step === STEP_REVIEW_LAUNCH ? "step" : undefined}
            >
              {accountStepRequired ? "6. Review and launch" : "5. Review and launch"}
            </button>
          </div>

          {accountStepRequired ? (
            <div className="director-existing-account-callout">
              <span>Already created your director account?</span>
              <Link to={loginPath}>Log in and continue onboarding</Link>
            </div>
          ) : null}

          <div className="director-step-content" key={step}>
          {draftRestoredNotice ? (
            <p className="director-draft-restored">{draftRestoredNotice}</p>
          ) : null}
          {saveLaterStatus ? (
            <p className="director-draft-restored director-draft-restored--info">{saveLaterStatus}</p>
          ) : null}
          {checkoutReturnStatus ? (
            <p className="director-draft-restored director-draft-restored--info">{checkoutReturnStatus}</p>
          ) : null}
          {step === STEP_ACCOUNT ? (
            <>
              <div className="director-design-head director-design-head--styled">
                <div className="director-design-intro">
                  <h1>Create your director account</h1>
                  <p className="product-claim-body director-create-subtitle">
                    This will be your admin login for setting up and managing your camp&apos;s network.
                  </p>
                </div>
              </div>

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

                  <div className="wizard1-field wizard1-span-6">
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

                  <div className="wizard1-field wizard1-span-6">
                    <label className="wizard1-label" htmlFor="director-camp-type">
                      Camp type<span className="req" aria-hidden="true"> *</span>
                    </label>
                    <select
                      id="director-camp-type"
                      className={`wizard1-input ${errors.campType ? "has-error" : ""}`}
                      value={normalizeCampType(form.campType || "coed")}
                      onChange={(event) => updateField("campType", event.target.value)}
                    >
                      {CAMP_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {errors.campType ? <p className="wizard1-error">{errors.campType}</p> : null}
                  </div>

                  {mailingAddressFields}

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label">
                      {availablePlanOptions.length > 1 ? "Choose" : "Your"} {alumniWord} network plan
                      <span className="req" aria-hidden="true"> *</span>
                    </label>
                    <div className="director-plan-grid" role="radiogroup" aria-label={`Choose ${alumniWord} network plan`}>
                      {availablePlanOptions.map((option) => (
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
                              {formatMoney(annualAmountForPlanOption(option.code))}/year
                              {" · "}
                              {onboardingFeeAmountForPlanOption(option.code) > 0
                                ? `${formatMoney(onboardingFeeAmountForPlanOption(option.code))} onboarding fee (first checkout only)`
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
                  <div className="director-create-actions-left">
                    <button
                      type="button"
                      className="wizard1-btn-secondary"
                      onClick={() => navigate(backPath)}
                      disabled={finishing}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
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
                    {`Choose your camp colors, logo, and main photo. The live site simulation updates immediately so you can review the public landing page and the signed-in ${alumniWord} experience before saving.`}
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToFeatures} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-design-fields">
                  {!accountStepRequired ? (
                    <div className="wizard1-field wizard1-span-6">
                      <label className="wizard1-label" htmlFor="director-design-camp-type">
                        Camp type<span className="req" aria-hidden="true"> *</span>
                      </label>
                      <select
                        id="director-design-camp-type"
                        className={`wizard1-input ${errors.campType ? "has-error" : ""}`}
                        value={normalizeCampType(form.campType || "coed")}
                        onChange={(event) => updateField("campType", event.target.value)}
                      >
                        {CAMP_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {errors.campType ? <p className="wizard1-error">{errors.campType}</p> : null}
                    </div>
                  ) : null}

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
                        aria-label="Main color hex value"
                      />
                    </div>
                    <BrandImageColorPicker
                      value={themeDraft.brandPrimary}
                      onPickColor={(nextHex) => updateThemeField("brandPrimary", nextHex)}
                    />
                    {themeErrors.brandPrimary ? (
                      <p className="wizard1-error">{themeErrors.brandPrimary}</p>
                    ) : null}
                    <div className="director-palette-preview" aria-label="Brand palette preview">
                      {paletteSwatches.map((swatch) => (
                        <div className="director-palette-swatch" key={swatch.label}>
                          <span
                            className="director-palette-chip"
                            style={{ backgroundColor: swatch.color }}
                            aria-hidden="true"
                          />
                          <span>{swatch.label}</span>
                          <code>{swatch.color.toUpperCase()}</code>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-logo-upload">
                      Logo upload
                    </label>
                    <label className="director-upload-control" htmlFor="director-logo-upload">
                      <span className="director-upload-button">Upload logo</span>
                      <span className="director-upload-name">
                        {logoFileName || "PNG or JPG"}
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
                        {heroFileName || "Used on login and home pages. PNG or JPG"}
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

                  <div className="wizard1-field wizard1-span-12">
                    <label className="wizard1-label" htmlFor="director-member-photo-upload">
                      Member home photo <small>optional</small>
                    </label>
                    <label className="director-upload-control" htmlFor="director-member-photo-upload">
                      <span className="director-upload-button">Upload member home photo</span>
                      <span className="director-upload-name">
                        {memberHeroFileName ||
                          (themeDraft.heroImageUrlMember
                            ? "Member home photo uploaded"
                            : "Only if you want a different photo once members log in")}
                      </span>
                    </label>
                    <input
                      id="director-member-photo-upload"
                      type="file"
                      accept="image/*"
                      className="director-upload-input"
                      onChange={onMemberHeroUpload}
                    />
                    <p className="wizard1-hint">
                      Leave this empty and the logged-in home reuses your main photo.
                    </p>
                    {themeDraft.heroImageUrlMember ? (
                      <button type="button" className="wizard1-btn-text" onClick={onClearMemberHero}>
                        Use the main photo instead
                      </button>
                    ) : null}
                  </div>

                  <aside className="wizard1-span-12 director-design-simulator" aria-label="Live site simulation">
                    <HeroImageEditor
                      label="Live site simulation"
                      variant="onboarding"
                      heroImageUrl={themeDraft.heroImageUrl}
                      memberImageUrl={themeDraft.heroImageUrlMember}
                      landingImagePosition={themeDraft.heroImagePositionLanding}
                      landingImageSize={themeDraft.heroImageSizeLanding}
                      memberImagePosition={themeDraft.heroImagePositionMember}
                      memberImageSize={themeDraft.heroImageSizeMember}
                      logoUrl={themeDraft.logoUrl}
                      brandPrimary={effectiveMainColor}
                      campName={form.campName || "Your Camp"}
                      campType={selectedCampType}
                      welcomeBody={campSpecifics.homepageQuote || "Reconnect with your camp community."}
                      enabledFeatureLabels={enabledFeatureLabels}
                      onChangeLandingPosition={(nextValue) =>
                        setThemeDraft((prev) => ({
                          ...prev,
                          heroImagePosition: normalizeHeroImagePosition(
                            nextValue || DEFAULT_HERO_IMAGE_POSITION
                          ),
                          heroImagePositionLanding: normalizeHeroImagePosition(
                            nextValue || DEFAULT_HERO_IMAGE_POSITION
                          )
                        }))
                      }
                      onChangeLandingSize={(nextValue) =>
                        setThemeDraft((prev) => ({
                          ...prev,
                          heroImageSize: normalizeHeroImageSize(nextValue || DEFAULT_HERO_IMAGE_SIZE),
                          heroImageSizeLanding: normalizeHeroImageSize(
                            nextValue || DEFAULT_HERO_IMAGE_SIZE
                          )
                        }))
                      }
                      onChangeMemberPosition={(nextValue) =>
                        setThemeDraft((prev) => ({
                          ...prev,
                          heroImagePositionMember: normalizeHeroImagePosition(
                            nextValue || DEFAULT_HERO_IMAGE_POSITION
                          )
                        }))
                      }
                      onChangeMemberSize={(nextValue) =>
                        setThemeDraft((prev) => ({
                          ...prev,
                          heroImageSizeMember: normalizeHeroImageSize(nextValue || DEFAULT_HERO_IMAGE_SIZE)
                        }))
                      }
                    />
                  </aside>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <div className="director-create-actions-left">
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
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
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
              <div className="director-design-head director-design-head--styled">
                <div className="director-design-intro">
                  <h1>Choose your features</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Pick the features your network launches with. You can turn any of them on or off later
                    from your admin settings.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToCampSpecifics} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-feature-fields">
                  <div className="wizard1-span-12">
                    <div className="director-feature-grid">
                      {featureOptionsForCopy.map((item) => (
                        <div className="director-feature-item" key={item.key}>
                          <div>
                            <div className="director-feature-copy">
                              <div className="director-feature-title-row">
                                <strong>{item.title}</strong>
                              </div>
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
                  <div className="director-create-actions-left">
                    <button
                      type="button"
                      className="wizard1-btn-secondary"
                      onClick={() => setStep(STEP_DESIGN)}
                      disabled={finishing}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
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
              <div className="director-design-head director-design-head--styled">
                <div className="director-design-intro">
                  <h1>Camp specifics</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Add your camp mailing address, then set the naming your camp uses for age groups and
                    staff roles.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToBillingPlan} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-specifics-fields">
                  {mailingAddressOnSpecificsStep ? mailingAddressFields : null}

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
                  <div className="director-create-actions-left">
                    <button
                      type="button"
                      className="wizard1-btn-secondary"
                      onClick={() => setStep(STEP_FEATURES)}
                      disabled={finishing}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
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
              <div className="director-design-head director-design-head--styled">
                <div className="director-design-intro">
                  <h1>Billing and plan</h1>
                  <p className="product-claim-body director-create-subtitle">
                    Review pricing before launch. Stripe collects payment and billing address securely in a form
                    that opens right here on the final step.
                  </p>
                </div>
              </div>

              <form className="director-create-form" onSubmit={onContinueToReviewLaunch} noValidate>
                <div className="wizard1-grid wizard1-gap director-create-fields director-billing-fields">
                  <div className="wizard1-span-12">
                    <article className="director-summary-card director-billing-stage-callout">
                      <h3>What happens in billing</h3>
                      <p className="director-summary-main">No charge is made on this step.</p>
                      <p className="director-field-hint">
                        Payment opens in a secure Stripe form on the final review step. You stay in onboarding the
                        whole time.
                      </p>
                    </article>
                  </div>

                  <div className="wizard1-span-12">
                    <div className="director-billing-overview-grid">
                      <article className="director-summary-card director-billing-highlight">
                        <h3>{`Selected ${alumniWord} network plan`}</h3>
                        <p className="director-summary-main">{billingPlanLabel(selectedBillingPlanCode, availablePlanOptions)}</p>
                        <dl className="director-billing-kv">
                          <div>
                            <dt>Annual subscription</dt>
                            <dd>{formatMoney(selectedPlanAnnualAmount)} / year</dd>
                          </div>
                          <div>
                            <dt>Onboarding fee</dt>
                            <dd>
                              {selectedPlanOnboardingFeeAmount > 0
                                ? `${formatMoney(selectedPlanOnboardingFeeAmount)} (first checkout only)`
                                : "No onboarding fee"}
                            </dd>
                          </div>
                        </dl>
                      </article>

                      <article className="director-summary-card director-billing-highlight">
                        <h3>Onboarding fee status</h3>
                        <p className="director-summary-main">{onboardingFeeStatusText}</p>
                        <p className="director-field-hint">
                          Stripe is the source of truth for payment, billing address, and invoice state.
                        </p>
                      </article>
                    </div>
                  </div>

                  <div className="wizard1-span-12">
                    <article className="director-summary-card">
                      <h3>Stripe checkout will collect</h3>
                      <ul className="director-review-list">
                        <li>Billing address and payment method securely in Stripe, without leaving this page.</li>
                        <li>Any onboarding fee (if applicable) with first-year subscription.</li>
                        <li>Tax and invoice details needed for billing records.</li>
                      </ul>
                      <p className="director-field-hint">
                        The moment payment succeeds, your network launches automatically.
                      </p>
                    </article>
                  </div>

                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <div className="director-create-actions-left">
                    <button
                      type="button"
                      className="wizard1-btn-secondary"
                      onClick={() => setStep(STEP_CAMP_SPECIFICS)}
                      disabled={finishing}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
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
              <form className="director-create-form" onSubmit={onCompleteSetup} noValidate>
                <div className="director-review-shell">
                  <section className="director-review-hero">
                    <div className="director-review-hero-main">
                      <p className="director-review-eyebrow">Launch Snapshot</p>
                      <h2>{networkDisplayNamePreview}</h2>
                      <p>Everything is ready for a final review. Launch will publish these settings live.</p>
                      <div className="director-review-pill-row">
                        <span className="director-review-pill is-brand">{billingPlanLabel(selectedBillingPlanCode, availablePlanOptions)}</span>
                        <span className="director-review-pill">{enabledModulesCount} modules enabled</span>
                        <span className="director-review-pill">{onboardingFeeStatusText}</span>
                      </div>
                    </div>
                    <div className="director-review-hero-side">
                      <div className="director-review-domain-card">
                        <span>Network domain</span>
                        <strong>{provisionedDomainPreview}</strong>
                      </div>
                      <div className="director-review-color-swatch-row">
                        <span>Main brand color</span>
                        <div className="director-review-color-value">
                          <i
                            className="director-review-color-chip"
                            style={{ backgroundColor: themeDraft.brandPrimary }}
                            aria-hidden="true"
                          />
                          <code>{themeDraft.brandPrimary}</code>
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="director-review-grid">
                    <article className="director-review-card">
                      <h3>Account</h3>
                      <dl className="director-review-kv">
                        <div>
                          <dt>Name</dt>
                          <dd>{reviewDirectorName}</dd>
                        </div>
                        <div>
                          <dt>Email</dt>
                          <dd>{form.email || "Not set"}</dd>
                        </div>
                        <div>
                          <dt>Camp</dt>
                          <dd>{form.campName || "Not set"}</dd>
                        </div>
                        <div>
                          <dt>Plan</dt>
                          <dd>{billingPlanLabel(selectedBillingPlanCode, availablePlanOptions)}</dd>
                        </div>
                      </dl>
                    </article>

                    <article className="director-review-card">
                      <h3>Design</h3>
                      <div className="director-review-mini-preview">
                        <div className="director-review-mini-preview-top" style={{ background: themeDraft.brandPrimary }}>
                          {themeDraft.logoUrl ? <img src={themeDraft.logoUrl} alt="" /> : <span>{networkPreviewInitials}</span>}
                          <strong>{networkDisplayNamePreview}</strong>
                        </div>
                        <div
                          className="director-review-mini-preview-hero"
                          style={designPreviewHeroStyle}
                        />
                      </div>
                      <dl className="director-review-kv">
                        <div>
                          <dt>Logo</dt>
                          <dd>{themeDraft.logoUrl ? "Uploaded" : "Not uploaded"}</dd>
                        </div>
                        <div>
                          <dt>Main photo</dt>
                          <dd>{themeDraft.heroImageUrl ? "Uploaded" : "Not uploaded"}</dd>
                        </div>
                        <div>
                          <dt>Member home photo</dt>
                          <dd>
                            {themeDraft.heroImageUrlMember ? "Uploaded" : "Same as main photo"}
                          </dd>
                        </div>
                        <div>
                          <dt>Framing</dt>
                          <dd>{mainPhotoFramingLabel}</dd>
                        </div>
                      </dl>
                    </article>

                    <article className="director-review-card">
                      <h3>Features</h3>
                      <div className="director-review-feature-pills">
                        {enabledFeatureLabels.length ? (
                          enabledFeatureLabels.map((label) => (
                            <span key={label}>{label}</span>
                          ))
                        ) : (
                          <span>None</span>
                        )}
                      </div>
                      {modulesDraft.newsletter ? (
                        <dl className="director-review-kv director-review-kv--compact">
                          <div>
                            <dt>Newsletter label</dt>
                            <dd>{String(newsletterName || "").trim() || "Newsletter"}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </article>

                    <article className="director-review-card">
                      <h3>Camp specifics</h3>
                      <dl className="director-review-kv">
                        <div>
                          <dt>Age groups</dt>
                          <dd>{reviewAgeGroups.join(", ") || "Not set"}</dd>
                        </div>
                        <div>
                          <dt>Staff roles</dt>
                          <dd>{reviewStaffRoles.join(", ") || "Not set"}</dd>
                        </div>
                        <div>
                          <dt>Homepage quote</dt>
                          <dd>{String(campSpecifics.homepageQuote || "").trim() || "Not set"}</dd>
                        </div>
                        {modulesDraft.merchShop ? (
                          <div>
                            <dt>Merch link</dt>
                            <dd>{String(campSpecifics.merchShopUrl || "").trim() || "Not set"}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </article>

                    <article className="director-review-card director-review-card--wide">
                      <h3>Billing and plan</h3>
                      <dl className="director-review-kv director-review-kv--two">
                        <div>
                          <dt>Plan confirmed</dt>
                          <dd>{billingPlanLabel(selectedBillingPlanCode, availablePlanOptions)}</dd>
                        </div>
                        <div>
                          <dt>Onboarding fee</dt>
                          <dd>
                            {formatMoney(onboardingFeeAmount)}
                            {onboardingFeeAmount > 0 ? " (first checkout only)" : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Onboarding fee status</dt>
                          <dd>{onboardingFeeStatusText}</dd>
                        </div>
                        <div>
                          <dt>Billing details</dt>
                          <dd>Collected in the Stripe payment form at launch</dd>
                        </div>
                      </dl>
                    </article>
                  </div>

                  <article className="director-review-legal-card">
                    <h3>Legal confirmation required</h3>
                    <label className={`director-inline-checkbox ${legalAgreementError ? "has-error" : ""}`} htmlFor="director-legal-agreement">
                      <input
                        id="director-legal-agreement"
                        type="checkbox"
                        checked={legalAgreementAccepted}
                        aria-invalid={Boolean(legalAgreementError)}
                        aria-describedby={
                          legalAgreementError
                            ? "director-legal-agreement-hint director-legal-agreement-error"
                            : "director-legal-agreement-hint"
                        }
                        onChange={(event) => {
                          setLegalAgreementAccepted(event.target.checked);
                          setLegalAgreementError("");
                          setSubmitError("");
                        }}
                      />
                      <span>
                        I agree to PondBridge Terms, Director Agreement, and Privacy Policy for launching this network.
                      </span>
                    </label>
                    <p id="director-legal-agreement-hint" className="director-field-hint">
                      Required before launch. Review{" "}
                      <Link to={`/t/${slug}/director-legal`} target="_blank" rel="noopener noreferrer">
                        PondBridge Client Terms &amp; Privacy
                      </Link>.
                    </p>
                    {legalAgreementError ? (
                      <p id="director-legal-agreement-error" className="wizard1-error" role="alert">
                        {legalAgreementError}
                      </p>
                    ) : null}
                  </article>
                </div>

                {submitError ? <p className="wizard1-error director-create-submit-error">{submitError}</p> : null}

                <div className="wizard1-actions director-create-actions">
                  <div className="director-create-actions-left">
                    <button
                      type="button"
                      className="wizard1-btn-secondary"
                      onClick={() => setStep(STEP_BILLING_PLAN)}
                      disabled={finishing}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="wizard1-btn-secondary director-save-later-btn"
                      onClick={onSaveAndContinueLater}
                      disabled={finishing || savingForLater}
                    >
                      {savingForLater ? "Saving..." : "Save and continue later"}
                    </button>
                  </div>
                  <div className="wizard1-actions-right">
                    <button
                      type="submit"
                      className="wizard1-btn-primary director-finish-btn"
                      disabled={finishing}
                    >
                      {finishing
                        ? "Saving..."
                        : accountStepRequired
                        ? "Create account & launch network"
                        : "Launch network"}
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
