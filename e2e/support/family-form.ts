import { expect, type Page } from "@playwright/test";

/**
 * Family page helpers for the browser specs. A household with nobody on file is asked about the person who signed up
 * first ("About you", saved as "self", no relationship field, DC 21 Nov 2026); only then is the family form offered.
 */

/** What the status line says after a person is saved: "Saved." for the owner, "Family member added." for the others. */
export const FAMILY_ADDED = /^(Saved\.|Family member added\.)$/;

/** Waits until the Family page has loaded, so the form shows the fields it will keep (the button is disabled until then). */
export async function familyFormReady(page: Page) {
  await expect(page.getByRole("button", { name: /^(Save|\+ Add person)$/ }).last()).toBeEnabled({ timeout: 30_000 });
}

/** Whether the form is the owner's own ("About you"): it has no relationship field. */
export async function isAboutYou(page: Page) {
  await familyFormReady(page);
  return (await page.locator("#fm-new-relationship").count()) === 0;
}

/**
 * Chooses the new person's relationship. On the owner's own form there is none to choose: "self" needs nothing, and for
 * anyone else a synthetic owner is saved first (as a real new household must), then the typed name is put back.
 */
export async function chooseRelationship(page: Page, relationship: string) {
  const select = page.locator("#fm-new-relationship");
  if (!(await isAboutYou(page))) return select.selectOption(relationship);
  if (relationship === "self") return;
  const typed = await page.locator("#fm-new-name").inputValue();
  await page.locator("#fm-new-name").fill("Test Owner");
  await page.locator("#fm-new-dob").fill("1980-01-01");
  if (await page.locator("#fm-new-sex").count()) await page.locator("#fm-new-sex").selectOption("unspecified");
  await page.locator("#fm-new-preferred").fill("Owner");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(select).toBeVisible({ timeout: 30_000 });
  await page.locator("#fm-new-name").fill(typed);
  await select.selectOption(relationship);
}
