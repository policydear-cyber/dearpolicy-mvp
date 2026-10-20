/** Household answers this browser keeps when the server cannot remember them yet. They belong to the signed-in
 * household, so signing out clears them (another household may sign in on the same device). */
export const NOT_FAMILY_KEY = "dearpolicy.notFamily";

export function clearHouseholdDeviceMemory() {
  try { localStorage.removeItem(NOT_FAMILY_KEY); } catch { /* storage unavailable */ }
}
