import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerViaApi(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  opts: { name: string; email: string; password: string },
): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: opts,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `API register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe('Register', () => {
  test('happy path — creates account, auto-logs in, and redirects to /drive', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');

    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create free account' }).click();

    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

    const accessToken = await page.evaluate(() => localStorage.getItem('access_token'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'));
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('duplicate email — shows error message', async ({ page, request }) => {
    const email = uniqueEmail();

    // Pre-register the same email via API
    await registerViaApi(request, {
      name: 'Existing User',
      email,
      password: 'Password123!',
    });

    await page.goto('/register');

    await page.getByLabel('Name').fill('Duplicate User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create free account' }).click();

    // Should stay on register page and show an error
    await expect(page).toHaveURL(/\/register/, { timeout: 10_000 });
    await expect(page.locator('p.error, [class*="error"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('password too short — browser validation prevents submission', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Name').fill('Short Pass User');
    await page.getByLabel('Email').fill(uniqueEmail());
    // 7 characters — below the minLength=8 requirement
    await page.getByLabel('Password').fill('Short1!');

    // Intercept any outgoing register request
    let requestMade = false;
    page.on('request', req => {
      if (req.url().includes('/api/v1/auth/register')) requestMade = true;
    });

    await page.getByRole('button', { name: 'Create free account' }).click();

    // Give a moment for any potential request
    await page.waitForTimeout(1000);

    // HTML5 minLength constraint should have prevented the form from submitting
    expect(requestMade).toBe(false);
    await expect(page).toHaveURL(/\/register/);
  });

  test('register page links to sign-in', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
