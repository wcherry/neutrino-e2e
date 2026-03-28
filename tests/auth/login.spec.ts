import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Create a user via API and return their credentials. */
async function createUser(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  overrides?: Partial<{ name: string; email: string; password: string }>,
): Promise<{ name: string; email: string; password: string }> {
  const creds = {
    name: overrides?.name ?? 'Test User',
    email: overrides?.email ?? uniqueEmail(),
    password: overrides?.password ?? 'Password123!',
  };

  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: creds,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `API register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  return creds;
}

test.describe('Login', () => {
  test('happy path — logs in with valid credentials and redirects to /drive', async ({
    page,
    request,
  }) => {
    const { email, password } = await createUser(request);

    await page.goto('/sign-in');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

    const accessToken = await page.evaluate(() => localStorage.getItem('access_token'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('refresh_token'));
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  test('wrong password — shows error message', async ({ page, request }) => {
    const { email } = await createUser(request);

    await page.goto('/sign-in');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('WrongPassword99!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    await expect(page.locator('p.error, [class*="error"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('unknown email — shows error message', async ({ page }) => {
    await page.goto('/sign-in');

    await page.getByLabel('Email').fill('nobody_exists@example.com');
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
    await expect(page.locator('p.error, [class*="error"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('protected route — unauthenticated visit to /drive redirects to /sign-in', async ({
    page,
  }) => {
    // Ensure no tokens are present
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });

    await page.goto('/drive');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });

  test('logout flow — after logout, /drive redirects to /sign-in', async ({ page, request }) => {
    const { email, password } = await createUser(request);

    // Log in via UI
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

    // Call logout endpoint directly (simulates the app calling authApi.logout())
    const accessToken = await page.evaluate(() => localStorage.getItem('access_token'));
    await request.post(`${BASE_URL}/api/v1/auth/logout`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Clear tokens from localStorage (authApi.logout() does this)
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });

    // A protected route should now redirect back to sign-in
    await page.goto('/drive');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });

  test('sign-in page links to register', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Create one free' })).toBeVisible();
    await page.getByRole('link', { name: 'Create one free' }).click();
    await expect(page).toHaveURL(/\/register/);
  });
});
