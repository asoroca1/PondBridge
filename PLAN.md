# Premium Onboarding: Implementation Plan

## Overview
6 features to transform the director onboarding wizard from a form into a premium experience. All work is contained in 3 files:
- `apps/web/src/pages/DirectorCreateAccountPage.jsx` (wizard)
- `apps/web/src/styles/productOnboarding.css` (styles)
- `apps/web/src/pages/DirectorOnboardingCommandCenterPage.jsx` (post-launch)

---

## Feature 1: Draft Auto-Save via localStorage

**Problem:** If the director closes their tab mid-setup, all progress is lost.

**Approach:** localStorage-based persistence (the director doesn't have an account/token until final submit, so API-saving isn't possible for most of the flow).

**Implementation:**
1. Create a `DRAFT_STORAGE_KEY` constant: `"pondbridge_director_draft_{slug}"`
2. Add a `saveDraftToStorage()` helper that serializes all form state to localStorage:
   - `form` (account fields)
   - `themeDraft` (colors, logo data URL, hero data URL)
   - `modulesDraft` (feature toggles)
   - `newsletterName`
   - `campSpecifics` (age groups, staff roles, quote, merch URL)
   - `billingDetails` (addresses)
   - `selectedPlanTier`
   - `step` (current step)
   - `savedAt` timestamp
3. Add a `loadDraftFromStorage()` helper that deserializes and returns saved state (or null)
4. Call `saveDraftToStorage()` every time the user advances a step (in the `goToStep` and each `onContinueTo*` handler) — NOT on every keystroke (that would be noisy and save huge data URLs constantly)
5. On mount, in the existing `useEffect` or a new one, call `loadDraftFromStorage()` and hydrate all state setters if a draft exists
6. After successful launch (in `onCompleteSetup`), clear the draft from localStorage
7. Show a subtle "Draft restored" toast/notice if hydrating from a saved draft so the director knows their progress was preserved
8. Do NOT save sensitive fields (password, confirmPassword) to localStorage

**Key detail:** Logo and hero images are stored as base64 data URLs in `themeDraft.logoUrl` / `themeDraft.heroImageUrl`. These can be large (up to ~800KB after optimization). localStorage has a ~5MB limit per origin, so this is fine.

---

## Feature 2: Launch Celebration Moment

**Problem:** After launch succeeds, the user just gets a redirect. The most emotionally important moment has zero payoff.

**Approach:** Full-screen overlay with CSS animations, shown for a few seconds before the user proceeds.

**Implementation:**
1. Add new state: `launchSuccess` (null or `{ campName, domain, loginUrl }`)
2. In `onCompleteSetup`, after the launch API call succeeds, set `launchSuccess` instead of immediately navigating
3. Render a celebration overlay when `launchSuccess` is set:
   - Full-screen fixed overlay with gradient background using their brand color
   - Camp name displayed prominently
   - "Your network is live!" heading with a scale-in animation
   - Their custom domain shown as a clickable link
   - Animated CSS burst/sparkle effect (pure CSS keyframes — no library)
   - "Go to your launch center" button to proceed with the navigation
4. CSS: New `@keyframes` for `celebrationFadeIn`, `celebrationPulse`, `celebrationSparkle`
5. Respect `prefers-reduced-motion`: skip animations, show static version

---

## Feature 3: Live Network Preview on Design Step

**Problem:** The current preview is a colored bar with "Logo" text and "Main photo preview" text. It doesn't look like the actual network.

**Approach:** Replace the basic preview with a mini version of what the network's login/home page looks like.

**Implementation:**
1. Replace the `director-design-preview` content with a richer mockup:
   - **Nav bar:** Brand-colored bar with logo + camp name (already exists, keep it)
   - **Hero section:** Full background image with gradient overlay, welcome headline, and mock "Create Account" / "Sign In" buttons in the brand color
   - **Below-fold:** A small mock content area showing a card with placeholder text, styled with the theme's card/bg/text colors
2. All elements use inline styles or CSS variables tied to `themeDraft` so they update live
3. Add new CSS classes: `director-preview-hero`, `director-preview-buttons`, `director-preview-content-area`, `director-preview-mock-card`
4. The welcome headline in the preview uses the camp name: "Welcome to {campName} Alumni Network"
5. Mock buttons show the derived secondary color alongside the primary color
6. Scale the preview to ~60% size using `transform: scale()` in a container with `overflow: hidden` to make it feel like a browser viewport preview

---

## Feature 4: Step Transitions

**Problem:** Steps swap instantly with no animation, making the wizard feel like a static form.

**Approach:** CSS animation triggered by React key change on each step's wrapper.

**Implementation:**
1. Wrap each step's content (the `<>...</>` fragments currently inside each `{step === STEP_X ? (...) : null}`) in a `<div className="director-step-body" key={step}>` container
2. Instead of 6 separate conditionals, use a single container that renders the active step and applies the animation class
3. CSS `@keyframes directorStepEnter`: `opacity: 0, translateY(10px)` → `opacity: 1, translateY(0)` over `0.25s ease-out`
4. `.director-step-body` gets `animation: directorStepEnter 0.25s ease-out`
5. `@media (prefers-reduced-motion: reduce)` — set animation to `none`
6. This is purely additive CSS — no structural change to the JSX beyond wrapping each step block in a keyed div

---

## Feature 5: Smarter Color Tools

**Problem:** The director picks a hex color but can't see how it will look on actual UI elements.

**Approach:** Add a "palette preview" strip below the color picker showing the chosen color applied to common UI patterns.

**Implementation:**
1. Below the color picker row (after the hex input), add a new `director-palette-preview` div
2. Contains 4-5 inline mini-swatches showing:
   - **Nav bar swatch:** A small rectangle in the primary color with white text "Nav"
   - **Button swatch:** A rounded pill in primary color with white text "Button"
   - **Secondary swatch:** The derived secondary color (from `deriveSecondaryHex`) labeled "Secondary"
   - **Accent swatch:** The accent color (`#f2b134`) labeled "Accent"
   - **Card swatch:** White card with a top border in the primary color
3. All swatches use inline styles tied to `themeDraft.brandPrimary` so they update live as the color changes
4. CSS: `.director-palette-preview` is a flex row with gap, each swatch is ~60px wide × 36px tall with border-radius

---

## Feature 6: Post-Launch Guided Onboarding

**Problem:** After launch, the director lands on the command center with no guidance on what to do next.

**Approach:** When arriving with `?launched=1`, show a prominent welcome banner with a "first 3 things to do" mini-checklist.

**Implementation:**
1. In `DirectorOnboardingCommandCenterPage.jsx`, read `useSearchParams()` for `launched=1`
2. Add state: `showLaunchGuide` — true if `launched=1` AND localStorage doesn't have `"pondbridge_launch_guide_dismissed_{slug}"`
3. When `showLaunchGuide` is true, render a banner card at the very top (before the existing welcome Card):
   - Heading: "Your network is live! Here's what to do next."
   - 3-item checklist with links:
     1. "Import your alumni list" → `/t/${slug}/admin/import`
     2. "Invite key alumni to join" → `/t/${slug}/admin/invites`
     3. "Customize your welcome message" → `/t/${slug}/settings/content`
   - Dismiss button ("Got it") that sets localStorage flag and hides the banner
4. CSS: New `.launch-guide-banner` class with a subtle green/success left border, light background

---

## Implementation Order

1. **Step Transitions** (Feature 4) — smallest change, immediate visual impact, ~15 min
2. **Smarter Color Tools** (Feature 5) — small additive JSX + CSS, ~20 min
3. **Live Network Preview** (Feature 3) — replace existing preview, moderate complexity, ~30 min
4. **Draft Auto-Save** (Feature 1) — new helpers + hydration logic, moderate complexity, ~30 min
5. **Launch Celebration** (Feature 2) — new overlay + CSS animations, ~25 min
6. **Post-Launch Guide** (Feature 6) — separate file, self-contained, ~15 min

Total estimate: ~2-2.5 hours of implementation
