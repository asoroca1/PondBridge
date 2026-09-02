// Camp AI and the mobile app are not ready to put in front of directors yet, so
// every director dashboard surface that names them is hidden behind these two
// flags. Flip a flag back to `false` to restore that surface — nothing else has
// to change, and no data or API behavior is touched.
export const HIDE_CAMP_AI = true;
export const HIDE_MOBILE_APP = true;

// Keys from the /features capability inventory that belong to the surfaces
// above, so the Services & plan list can drop them the same way.
const HIDDEN_CAPABILITY_KEYS = new Set([
  ...(HIDE_CAMP_AI ? ["director_copilot", "camp_ai_search"] : []),
  ...(HIDE_MOBILE_APP ? ["mobile_alerts"] : [])
]);

export function isHiddenCapability(capability) {
  return HIDDEN_CAPABILITY_KEYS.has(String(capability?.key || "").trim());
}
