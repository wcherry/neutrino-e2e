import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_tabs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheet Tabs Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByRole('textbox');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

test.describe('Spreadsheet sheet tabs', () => {
  test('switching sheets keeps cell data isolated per sheet', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/sheets');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Spreadsheets', {
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });

    const originalValue = 'Original sheet value';
    const renamedSheet = 'Q2 Plan';

    await setCell(page, 'A1', originalValue);
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(originalValue);

    await page.getByRole('button', { name: '+' }).click();
    await expect(page.getByText('Sheet 2', { exact: true })).toBeVisible();

    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible();
    await renameInput.fill(renamedSheet);
    await renameInput.press('Enter');

    await expect(page.getByText(renamedSheet, { exact: true })).toBeVisible();
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('');

    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(originalValue);
  });
});
