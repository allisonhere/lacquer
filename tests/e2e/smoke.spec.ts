import { test, expect } from '@playwright/test';
test('register, sign in, create salons, switch tenant, and create a location', async ({
  page,
}) => {
  const unique = crypto.randomUUID().slice(0, 8);
  const email = `smoke-${unique}@example.test`;
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Your business/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Create your account' }).click();
  await page.getByLabel('Your name').fill('Smoke Owner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Smoke-password-123!');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Create your salon' }),
  ).toBeVisible();
  await page.getByLabel('Salon name', { exact: true }).fill('Smoke Salon A');
  await page
    .getByLabel('Salon slug', { exact: true })
    .fill(`smoke-a-${unique}`);
  await page.getByRole('button', { name: 'Create salon', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Smoke Salon A', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add location' }).click();
  await page.getByLabel('Location name', { exact: true }).fill('Downtown');
  await page.getByLabel('Location slug', { exact: true }).fill('downtown');
  await page
    .getByRole('button', { name: 'Create location', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Downtown', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '+ Create salon', exact: true })
    .click();
  await page.getByLabel('Salon name', { exact: true }).fill('Smoke Salon B');
  await page
    .getByLabel('Salon slug', { exact: true })
    .fill(`smoke-b-${unique}`);
  await page.getByRole('button', { name: 'Create salon', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Smoke Salon B', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Downtown', exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Active salon')
    .selectOption({ label: 'Smoke Salon A' });
  await expect(
    page.getByRole('heading', { name: 'Downtown', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page
    .getByLabel('Password', { exact: true })
    .fill('Smoke-password-123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Active salon')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Smoke Salon A', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('workspace-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Active salon')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('workspace-mobile.png'),
    fullPage: true,
  });
});
