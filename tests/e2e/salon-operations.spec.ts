import { test, expect, type Page } from '@playwright/test';
/**
 * Milestone 2 admin flows end to end: create staff, a category, and a service;
 * make the technician eligible for it; edit a weekly schedule including a split
 * shift; and record time off.
 *
 * Deliberately not exhaustive visual testing — this walks the paths a salon
 * manager actually takes on their first day.
 */
const password = 'Smoke-password-123!';
async function signUpWithSalon(page: Page, unique: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Ops Owner');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`ops-${unique}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Create your salon' }),
  ).toBeVisible();
  await page.getByLabel('Salon name', { exact: true }).fill('Ops Salon');
  await page.getByLabel('Salon slug', { exact: true }).fill(`ops-${unique}`);
  await page.getByRole('button', { name: 'Create salon', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ops Salon', exact: true }),
  ).toBeVisible();
  // A location is required before a schedule can exist.
  await page.getByRole('button', { name: 'Add location' }).click();
  await page.getByLabel('Location name', { exact: true }).fill('Downtown');
  await page.getByLabel('Location slug', { exact: true }).fill('downtown');
  await page
    .getByRole('button', { name: 'Create location', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Downtown', exact: true }),
  ).toBeVisible();
}
test('salon operations: staff, catalog, eligibility, schedule, and time off', async ({
  page,
}) => {
  const unique = crypto.randomUUID().slice(0, 8);
  await signUpWithSalon(page, unique);

  /* --- Create a staff profile ------------------------------------------- */
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Staff', level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ Add team member' }).click();
  await page.getByLabel('Display name').fill('Alex Morgan');
  await page
    .getByRole('button', { name: 'Add team member', exact: true })
    .click();
  await expect(page.getByRole('link', { name: /Alex Morgan/ })).toBeVisible();

  /* --- Create a skill, a category, and a service ------------------------- */
  await page.getByRole('link', { name: 'Services', exact: true }).click();
  await page.getByRole('tab', { name: 'Skills' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Acrylic');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Skill created.')).toBeVisible();
  // The notice appears only after the catalog reload settles, so the list is
  // authoritative before moving on.
  await expect(
    page.getByRole('strong').filter({ hasText: 'Acrylic' }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Categories' }).click();
  await page.getByLabel('New category').fill('Acrylics');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Category added.')).toBeVisible();

  await page.getByRole('tab', { name: 'Services' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Acrylic Full Set');
  await page.getByLabel('Category').selectOption({ label: 'Acrylics' });
  await page.getByLabel('Price').fill('75.00');
  await page.getByLabel('Length (minutes)').fill('90');
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  await expect(
    page.getByRole('link', { name: /Acrylic Full Set/ }),
  ).toBeVisible();
  // Money round-trips through integer minor units, not a float.
  await expect(page.getByText('$75.00')).toBeVisible();

  /* --- Require a skill, then make the technician eligible ---------------- */
  await page.getByRole('link', { name: /Acrylic Full Set/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Acrylic Full Set', level: 1 }),
  ).toBeVisible();
  const requiredSkill = page.getByRole('checkbox', { name: 'Acrylic' });
  await requiredSkill.check();
  await expect(requiredSkill).toBeEnabled({ timeout: 15000 });
  await expect(requiredSkill).toBeChecked();
  await page.getByRole('tab', { name: 'Locations' }).click();
  const offeredHere = page.getByRole('checkbox', { name: 'Downtown' });
  await offeredHere.check();
  await expect(offeredHere).toBeEnabled({ timeout: 15000 });
  await expect(offeredHere).toBeChecked();
  // Without the skill, Alex is not eligible and the reason is shown.
  await page.getByRole('tab', { name: 'Who can do it' }).click();
  await expect(page.getByText('Not eligible')).toBeVisible();
  await expect(page.getByText('Missing a required skill')).toBeVisible();

  /* --- Assign the skill and the location to the technician --------------- */
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await page.getByRole('link', { name: /Alex Morgan/ }).click();
  await page.getByRole('tab', { name: 'Locations' }).click();
  const worksHere = page.getByRole('checkbox', { name: /Downtown/ });
  await worksHere.check();
  await expect(worksHere).toBeEnabled({ timeout: 15000 });
  await expect(worksHere).toBeChecked();
  await page.getByRole('tab', { name: 'Skills' }).click();
  const holdsSkill = page.getByRole('checkbox', { name: /Acrylic/ });
  await holdsSkill.check();
  await expect(holdsSkill).toBeEnabled({ timeout: 15000 });
  await expect(holdsSkill).toBeChecked();

  /* --- Eligibility now resolves to true ---------------------------------- */
  await page.getByRole('link', { name: 'Services', exact: true }).click();
  await page.getByRole('link', { name: /Acrylic Full Set/ }).click();
  await page.getByRole('tab', { name: 'Who can do it' }).click();
  await expect(page.getByText('Eligible', { exact: true })).toBeVisible();

  /* --- Edit the weekly schedule, including a split shift ----------------- */
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await page.getByRole('link', { name: /Alex Morgan/ }).click();
  await page.getByRole('tab', { name: 'Schedule' }).click();
  await expect(
    page.getByText(/Times are local to this location/),
  ).toBeVisible();
  const monday = page.locator('.week-day').first();
  await monday.getByRole('button', { name: '+ Shift' }).click();
  await monday
    .getByRole('textbox', { name: 'Monday work start', exact: true })
    .fill('09:00');
  await monday
    .getByRole('textbox', { name: 'Monday work end', exact: true })
    .fill('13:00');
  // A second Monday shift is a split shift, not a conflict.
  await monday.getByRole('button', { name: '+ Shift' }).click();
  await monday
    .getByRole('textbox', { name: 'Monday work start', exact: true })
    .nth(1)
    .fill('16:00');
  await monday
    .getByRole('textbox', { name: 'Monday work end', exact: true })
    .nth(1)
    .fill('20:00');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Schedule saved.')).toBeVisible();
  await expect(monday.locator('.shift')).toHaveCount(2);

  /* --- Overlapping shifts are rejected with a readable message ----------- */
  await monday.getByRole('button', { name: '+ Shift' }).click();
  await monday
    .getByRole('textbox', { name: 'Monday work start', exact: true })
    .nth(2)
    .fill('10:00');
  await monday
    .getByRole('textbox', { name: 'Monday work end', exact: true })
    .nth(2)
    .fill('14:00');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('alert')).toContainText('overlap');
  await monday
    .getByRole('button', { name: /Remove the shift on Monday at 10:00/ })
    .click();

  /* --- Record time off --------------------------------------------------- */
  await page.getByRole('tab', { name: 'Time off' }).click();
  await page.getByLabel('Starts').fill('2026-10-14T09:00');
  await page.getByLabel('Ends').fill('2026-10-16T17:00');
  await page.getByLabel('Reason').fill('Vacation');
  await page.getByRole('button', { name: 'Add time off', exact: true }).click();
  await expect(page.getByText('Time off recorded.')).toBeVisible();
  await expect(page.getByText('Vacation')).toBeVisible();

  /* --- Salon scheduling settings use human units ------------------------- */
  await page.getByRole('link', { name: 'Scheduling', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Scheduling', level: 1 }),
  ).toBeVisible();
  await page
    .getByLabel('How far ahead clients can book')
    .selectOption({ label: '30 days' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Scheduling settings saved.')).toBeVisible();

  /* --- Usable on a phone -------------------------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByRole('link', { name: /Alex Morgan/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('staff-mobile.png'),
    fullPage: true,
  });
});
