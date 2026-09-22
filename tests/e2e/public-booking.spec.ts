import { test, expect } from '@playwright/test';
/** Real seeded salon journey at phone width; no availability/booking mocks. */
test('guest books a salon visit and revisits its secure link on mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/book/lacquer-demo');
  await expect(
    page.getByRole('heading', { name: 'Find your little escape.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Downtown/ }).click();
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: /Acrylic Full Set/ }).click();
  await page
    .getByLabel('Make it your own')
    .selectOption({ label: 'Short · $75.00 90 min' });
  await page.getByRole('checkbox', { name: /French tips/ }).check();
  await page.getByRole('button', { name: 'Continue →' }).click();
  await expect(
    page.getByRole('button', { name: /Any Available Technician/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue →' }).click();
  await expect(page.getByLabel('Choose a date')).toBeVisible();
  // The seed has a real weekly rota; advance bounded dates rather than inventing a time.
  for (let day = 0; day < 14; day++) {
    await expect(page.getByRole('status')).toHaveCount(0);
    if (await page.locator('.time-slots button').count()) break;
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
  }
  const slot = page.locator('.time-slots button').first();
  await expect(slot).toBeVisible();
  // Time slots are native keyboard-operable buttons with a persistent selection state.
  await slot.focus();
  await page.keyboard.press('Enter');
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByLabel('First name', { exact: true }).fill('Morgan');
  await page.getByLabel('Last name', { exact: true }).fill('Lee');
  await page
    .getByLabel('Email', { exact: true })
    .fill(`guest-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Phone', { exact: true }).fill('+1 312 555 0100');
  await page
    .getByLabel(/Anything you’d like us to know/)
    .fill('Short almond shape please.');
  await page.getByRole('button', { name: 'Review booking →' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your next good nail day.' }),
  ).toBeVisible();
  await expect(
    page.getByText('America/Chicago', { exact: true }),
  ).toBeVisible();
  // Back/forward and refresh preserve details and never submit by navigation.
  await page.goBack();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue(
    'Morgan',
  );
  await page.goForward();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Confirm booking', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/public-booking-mobile-review.png',
    fullPage: true,
  });
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/public/lacquer-demo/bookings') &&
      r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Confirm booking', exact: true })
    .click();
  const created = await response;
  expect(created.status(), await created.text()).toBe(201);
  await expect(
    page.getByRole('heading', { name: 'You’re booked. Beautiful.' }),
  ).toBeVisible();
  const link = page.getByRole('link', { name: 'Your secure booking link' });
  await expect(link).toHaveAttribute(
    'href',
    /\/book\/manage\/[A-Za-z0-9_-]{43}$/,
  );
  await page.screenshot({
    path: 'test-results/public-booking-mobile-confirmation.png',
    fullPage: true,
  });
  await link.click();
  await expect(
    page.getByRole('heading', { name: 'Your next good nail day.' }),
  ).toBeVisible();
  await expect(page.getByText('Morgan Lee')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Acrylic Full Set', exact: true }),
  ).toBeVisible();
  const headers = await page.request.get(page.url());
  expect(headers.headers()['referrer-policy']).toBe('no-referrer');
  expect(headers.headers()['cache-control']).toBe('no-store');
  // A saved link works without the original browser's session or draft.
  const fresh = await page.context().browser()!.newContext();
  const revisit = await fresh.newPage();
  await revisit.goto(page.url());
  await expect(revisit.getByText('Morgan Lee')).toBeVisible();
  await fresh.close();
});
