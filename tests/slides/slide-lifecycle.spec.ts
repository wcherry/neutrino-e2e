import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `slides_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Slides Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

test.describe('Presentations lifecycle', () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  test('empty Presentations page shows two New Presentation buttons', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/slides');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Presentations');
    await expect(page.getByRole('button', { name: /new presentation/i })).toHaveCount(2);
  });

  // ── Full create → rename → back → list ──────────────────────────────────────

  test('creating a presentation, renaming it, and going back shows the renamed presentation in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/slides');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Presentations', {
      timeout: 10_000,
    });

    // Two "New Presentation" buttons appear when the list is empty
    await expect(page.getByRole('button', { name: /new presentation/i })).toHaveCount(2);

    // Click the header "New Presentation" button (first of the two)
    await page.getByRole('button', { name: /new presentation/i }).first().click();

    // Should navigate to the editor for the newly created presentation
    await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });

    // Wait for the editor toolbar to appear (back button visible means loading is done)
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

    // Change the presentation name
    const titleInput = page.getByPlaceholder('Untitled presentation');
    await titleInput.fill('Annual Review');

    // Set up the response listener before triggering the blur, then blur to save
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/slides/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.blur();
    await titleSaved;

    // Click the back button to return to the Presentations list
    await page.getByRole('button', { name: 'Slides' }).click();
    await expect(page).toHaveURL(/\/slides\/?$/, { timeout: 10_000 });

    // The renamed presentation should appear in the list
    await expect(page.getByRole('listitem', { name: 'Annual Review' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
