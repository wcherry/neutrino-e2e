/**
 * E2E tests for absolute cell references ($A$1, A$1, $A1).
 *
 * These tests verify that copying a cell formula containing $ anchors
 * correctly preserves the anchored dimensions and adjusts only the relative ones.
 *
 * Copy is exercised by dispatching a custom paste event that carries the
 * encoded clipboard payload, mirroring exactly how the application encodes
 * formulas during Ctrl+C / Ctrl+V.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'absref'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'absref',
): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Abs Ref Test User', email, password },
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Spreadsheets', {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /new spreadsheet/i }).first().click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
}

/** Click a cell, type a value into the formula bar, press Enter to commit. */
async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByRole('textbox');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

/** Wait for a cell's displayed text to equal the expected string. */
async function expectCell(page: Page, ref: string, expected: string): Promise<void> {
  await expect(page.locator(`[data-type="cell"][id="${ref}"] span`)).toHaveText(expected, {
    timeout: 8_000,
  });
}

/**
 * Copy the cell at `srcRef` then paste it at `destRef` using the application's
 * internal clipboard format (application/x-neutrino-sheet).
 *
 * This dispatches keyboard Ctrl+C on the source cell and Ctrl+V on the target
 * cell, relying on the document-level copy/paste event listeners registered by
 * useClipboard.
 */
async function copyPaste(page: Page, srcRef: string, destRef: string): Promise<void> {
  // Select source cell and copy
  await page.locator(`[data-type="cell"][id="${srcRef}"]`).click();
  await page.keyboard.press('Control+C');
  // Small wait to ensure the clipboard is populated
  await page.waitForTimeout(300);
  // Select destination cell and paste
  await page.locator(`[data-type="cell"][id="${destRef}"]`).click();
  await page.keyboard.press('Control+V');
  // Wait for the paste to settle
  await page.waitForTimeout(300);
}

/**
 * Read the raw formula stored in a cell by clicking it and reading the formula bar.
 */
async function getCellRaw(page: Page, ref: string): Promise<string> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByRole('textbox');
  return await formulaInput.inputValue();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Absolute cell references', () => {
  // ── $A$1 — both locked ───────────────────────────────────────────────────

  test('$A$1 copied one row down stays $A$1', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs1');
    await openNewSheet(page);

    // Put a known value at A1 so we can verify the formula resolves correctly
    await setCell(page, 'A1', '99');
    // Put the formula in B1
    await setCell(page, 'B1', '=$A$1');
    await expectCell(page, 'B1', '99');

    // Copy B1, paste to B2 (one row down)
    await copyPaste(page, 'B1', 'B2');

    // B2 should still reference $A$1 and display 99
    await expectCell(page, 'B2', '99');
    const raw = await getCellRaw(page, 'B2');
    expect(raw).toBe('=$A$1');
  });

  test('$A$1 copied one column right stays $A$1', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs2');
    await openNewSheet(page);

    await setCell(page, 'A1', '77');
    await setCell(page, 'B1', '=$A$1');
    await expectCell(page, 'B1', '77');

    // Copy B1, paste to C1 (one column right)
    await copyPaste(page, 'B1', 'C1');

    await expectCell(page, 'C1', '77');
    const raw = await getCellRaw(page, 'C1');
    expect(raw).toBe('=$A$1');
  });

  test('$A$1 copied diagonally stays $A$1', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs3');
    await openNewSheet(page);

    await setCell(page, 'A1', '55');
    await setCell(page, 'B1', '=$A$1');
    await expectCell(page, 'B1', '55');

    // Copy B1 to D4 (diagonal)
    await copyPaste(page, 'B1', 'D4');

    await expectCell(page, 'D4', '55');
    const raw = await getCellRaw(page, 'D4');
    expect(raw).toBe('=$A$1');
  });

  // ── A$1 — row locked ─────────────────────────────────────────────────────

  test('A$1 copied one row down stays A$1 (row stays 1)', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs4');
    await openNewSheet(page);

    await setCell(page, 'A1', '42');
    await setCell(page, 'B2', '=A$1');
    await expectCell(page, 'B2', '42');

    // Copy B2 to B3 (one row down)
    await copyPaste(page, 'B2', 'B3');

    // Column is relative (B stays B since we move straight down), row is fixed at 1
    await expectCell(page, 'B3', '42');
    const raw = await getCellRaw(page, 'B3');
    expect(raw).toBe('=A$1');
  });

  test('A$1 copied one column right adjusts column', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs5');
    await openNewSheet(page);

    await setCell(page, 'A1', '10');
    await setCell(page, 'B1', '20');
    await setCell(page, 'B2', '=A$1');
    await expectCell(page, 'B2', '10');

    // Copy B2 to C2 (one column right) — column shifts A→B, row stays 1
    await copyPaste(page, 'B2', 'C2');

    await expectCell(page, 'C2', '20');
    const raw = await getCellRaw(page, 'C2');
    expect(raw).toBe('=B$1');
  });

  // ── $A1 — column locked ──────────────────────────────────────────────────

  test('$A1 copied one column right stays $A1 (column stays A)', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs6');
    await openNewSheet(page);

    await setCell(page, 'A2', '33');
    await setCell(page, 'B2', '=$A1');
    // $A1 references A1 (row is relative: B2 is at row 2, so offset is -1, target row = 2 + (-1) = 1)
    // Actually $A1 means the formula was entered in B2 at row 2, referencing $A1 (absolute A, row 1)
    // Let's put a value in A1
    await setCell(page, 'A1', '100');
    await setCell(page, 'B2', '=$A1');
    await expectCell(page, 'B2', '100');

    // Copy B2 to C2 (one column right) — column locked at A, row relative stays 1
    await copyPaste(page, 'B2', 'C2');

    await expectCell(page, 'C2', '100');
    const raw = await getCellRaw(page, 'C2');
    expect(raw).toBe('=$A1');
  });

  test('$A1 copied one row down adjusts row', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs7');
    await openNewSheet(page);

    await setCell(page, 'A1', '11');
    await setCell(page, 'A2', '22');
    // Enter =$A1 in B1 (row relative offset = 0, column = A)
    await setCell(page, 'B1', '=$A1');
    await expectCell(page, 'B1', '11');

    // Copy B1 to B2 (one row down) — column stays A, row shifts 1→2
    await copyPaste(page, 'B1', 'B2');

    await expectCell(page, 'B2', '22');
    const raw = await getCellRaw(page, 'B2');
    expect(raw).toBe('=$A2');
  });

  // ── Absolute refs in a range ─────────────────────────────────────────────

  test('=SUM(A$1:B3) copied one row down fixes A$1 and adjusts B3', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'abs8');
    await openNewSheet(page);

    // A1=1, B1=2, A2=3, B2=4, A3=5, B3=6
    await setCell(page, 'A1', '1');
    await setCell(page, 'B1', '2');
    await setCell(page, 'A2', '3');
    await setCell(page, 'B2', '4');
    await setCell(page, 'A3', '5');
    await setCell(page, 'B3', '6');
    await setCell(page, 'A4', '7');
    await setCell(page, 'B4', '8');

    // C3 has =SUM(A$1:B3) — sums A1:B3 = 1+2+3+4+5+6 = 21
    await setCell(page, 'C3', '=SUM(A$1:B3)');
    await expectCell(page, 'C3', '21');

    // Copy C3 to C4 (one row down)
    // A$1 stays A1 (row locked), B3 shifts to B4
    // =SUM(A$1:B4) = A1:B4 = 1+2+3+4+5+6+7+8 = 36
    await copyPaste(page, 'C3', 'C4');

    await expectCell(page, 'C4', '36');
    const raw = await getCellRaw(page, 'C4');
    expect(raw).toBe('=SUM(A$1:B4)');
  });

  // ── Absolute refs in cross-sheet references ──────────────────────────────

  test('=Beta!$A$1 copied anywhere stays =Beta!$A$1', async ({ page, request }) => {
    test.setTimeout(90_000);
    await registerAndLogin(request, page, 'abs9');
    await openNewSheet(page);

    // Add a second sheet tab and rename it to "Beta"
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Sheet 2', { exact: true }).dblclick();
    const renameInput = page.locator('main input').last();
    await expect(renameInput).toBeVisible({ timeout: 5_000 });
    await renameInput.fill('Beta');
    await renameInput.press('Enter');
    await expect(page.getByText('Beta', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Set Beta!A1 = 123
    await setCell(page, 'A1', '123');

    // Switch to Sheet 1
    await page.getByText('Sheet 1', { exact: true }).click();
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 10_000 });

    // Set B2 = =Beta!$A$1
    await setCell(page, 'B2', '=Beta!$A$1');
    await expectCell(page, 'B2', '123');

    // Copy B2 to D5 (diagonal move)
    await copyPaste(page, 'B2', 'D5');

    await expectCell(page, 'D5', '123');
    const raw = await getCellRaw(page, 'D5');
    expect(raw).toBe('=Beta!$A$1');
  });
});
