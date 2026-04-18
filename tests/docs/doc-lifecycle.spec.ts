import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Docs Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

test.describe('Documents lifecycle', () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  test('empty Documents page shows two New Document buttons', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Documents');
    await expect(page.getByRole('button', { name: /new document/i })).toHaveCount(2);
  });

  // ── Full create → rename → back → list ──────────────────────────────────────

  test('creating a document, renaming it, and going back shows the renamed document in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/docs');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Documents', {
      timeout: 10_000,
    });

    // Two "New Document" buttons appear when the list is empty
    await expect(page.getByRole('button', { name: /new document/i })).toHaveCount(2);

    // Click the header "New Document" button (first of the two)
    await page.getByRole('button', { name: /new document/i }).first().click();

    // Should navigate to the editor for the newly created document
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });

    // Wait for the editor toolbar to appear (back button visible means loading is done)
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible({ timeout: 10_000 });

    // Change the document name
    const titleInput = page.getByPlaceholder('Untitled document');
    await titleInput.fill('My Budget');

    // Set up the response listener before triggering the blur, then blur to save
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/docs/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.blur();
    await titleSaved;

    // Click the back button to return to the Documents list
    await page.getByRole('button', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/?$/, { timeout: 10_000 });

    // The renamed document should appear in the list
    await expect(page.getByRole('listitem', { name: 'My Budget' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
