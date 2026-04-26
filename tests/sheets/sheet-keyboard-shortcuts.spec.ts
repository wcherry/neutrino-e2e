import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_kb_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheets KB Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openNewSheet(page: Page): Promise<void> {
  await page.goto('/sheets');
  await expect(page.getByRole('button', { name: /new spreadsheet/i })).toHaveCount(2, {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 10_000 });
  // Wait for the grid to be ready
  await expect(page.locator('[data-type="cell"]').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Sheets keyboard shortcuts', () => {
  // ── Ctrl+B (bold) ────────────────────────────────────────────────────────────

  test('Ctrl+B toggles bold on the selected cell', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    const boldBtn = page.getByTitle('Bold (Ctrl+B)');

    // Click cell A1 to select it
    await page.locator('#A1').click();

    // Press Ctrl+B to apply bold
    await page.keyboard.press('Control+B');

    // The bold toolbar button should now have the active class
    await expect(boldBtn).toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });
  });

  test('Ctrl+B toggles bold off when pressed again', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    const boldBtn = page.getByTitle('Bold (Ctrl+B)');

    // Click cell A1 and apply bold
    await page.locator('#A1').click();
    await page.keyboard.press('Control+B');
    await expect(boldBtn).toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });

    // Press Ctrl+B again to remove bold
    await page.keyboard.press('Control+B');

    // The active class should be gone
    await expect(boldBtn).not.toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });
  });

  // ── Ctrl+I (italic) ──────────────────────────────────────────────────────────

  test('Ctrl+I toggles italic on the selected cell', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    const italicBtn = page.getByTitle('Italic (Ctrl+I)');

    // Click cell A1 to select it
    await page.locator('#A1').click();

    // Press Ctrl+I to apply italic
    await page.keyboard.press('Control+I');

    // The italic toolbar button should now have the active class
    await expect(italicBtn).toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });
  });

  test('Ctrl+I toggles italic off when pressed again', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    const italicBtn = page.getByTitle('Italic (Ctrl+I)');

    // Click cell A1 and apply italic
    await page.locator('#A1').click();
    await page.keyboard.press('Control+I');
    await expect(italicBtn).toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });

    // Press Ctrl+I again to remove italic
    await page.keyboard.press('Control+I');

    // The active class should be gone
    await expect(italicBtn).not.toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });
  });

  // ── Guard: shortcut must not fire when an input has focus ────────────────────

  test('Ctrl+B has no effect when the sheet title input is focused', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    const boldBtn = page.getByTitle('Bold (Ctrl+B)');

    // Click cell A1 first so it is the active cell
    await page.locator('#A1').click();

    // Focus the sheet title input (a non-formula-bar text input)
    const titleInput = page.getByTestId('worksheet.name');
    await titleInput.click();

    // Press Ctrl+B while the title input has focus — should be a no-op for cell style
    await page.keyboard.press('Control+B');

    // The bold button must NOT have the active class
    await expect(boldBtn).not.toHaveClass(/toolbarBtnActive/, { timeout: 5_000 });
  });
});
