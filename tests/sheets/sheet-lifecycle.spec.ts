import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheets Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

test.describe('Spreadsheets lifecycle', () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  test('empty Spreadsheets page shows two New Spreadsheet buttons', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/sheets');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Spreadsheets');
    await expect(page.getByRole('button', { name: /new spreadsheet/i })).toHaveCount(2);
  });

  // ── Full create → rename → back → list ──────────────────────────────────────

  test('creating a spreadsheet, renaming it, and going back shows the renamed spreadsheet in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/sheets');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Spreadsheets', {
      timeout: 10_000,
    });

    // Two "New Spreadsheet" buttons appear when the list is empty
    await expect(page.getByRole('button', { name: /new spreadsheet/i })).toHaveCount(2);

    // Click the header "New Spreadsheet" button (first of the two)
    await page.getByRole('button', { name: /new spreadsheet/i }).first().click();

    // Should navigate to the editor for the newly created spreadsheet
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });

    // Wait for the back button to confirm the editor is ready
    await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 10_000 });

    // Change the spreadsheet name via the contentEditable title
    const titleInput = page.getByTestId('worksheet.name');
    await titleInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Q1 Budget');

    // Set up the response listener before triggering the blur, then blur to save
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/sheets/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.blur();
    await titleSaved;

    // Click the back button to return to the Spreadsheets list
    await page.getByRole('button', { name: 'Sheets' }).click();
    await expect(page).toHaveURL(/\/sheets\/?$/, { timeout: 10_000 });

    // The renamed spreadsheet should appear in the list
    await expect(page.getByRole('listitem', { name: 'Q1 Budget' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
